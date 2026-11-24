import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PUBLIC_DIR = path.join(HERE, 'public');
const REGISTRY = path.join(ROOT, 'games.json');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function readRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function lanAddresses() {
  const found = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) found.push({ name, address: item.address });
    }
  }

  const score = ({ name, address }) => {
    let value = 3;
    if (address.startsWith('192.168.')) value = 0;
    else if (address.startsWith('10.')) value = 1;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) value = 2;
    if (/vEthernet|VirtualBox|VMware|Tailscale|ZeroTier|WSL|Hyper-V/i.test(name)) value += 10;
    return value;
  };

  return [...new Set(found.sort((a, b) => score(a) - score(b)).map((item) => item.address))];
}

function probe(port, timeout = 450) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

let statusCache = { at: 0, data: null };

async function gamesPayload() {
  if (statusCache.data && Date.now() - statusCache.at < 3000) return statusCache.data;

  const registry = readRegistry();
  const games = await Promise.all(
    (registry.games || []).map(async (game) => ({
      ...game,
      online: await probe(game.port)
    }))
  );

  const data = { ...registry, games };
  statusCache = { at: Date.now(), data };
  return data;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/games') {
    try {
      return sendJson(res, 200, await gamesPayload());
    } catch (error) {
      console.error('[portal] games.json:', error.message);
      return sendJson(res, 500, { error: 'Не удалось прочитать games.json' });
    }
  }

  if (pathname === '/api/net') {
    const addresses = lanAddresses();
    return sendJson(res, 200, {
      ip: addresses[0] || null,
      addresses,
      port: PORT
    });
  }

  if (pathname === '/qr') {
    try {
      const text = String(url.searchParams.get('text') || `http://${req.headers.host}/`).slice(0, 1000);
      const svg = await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        width: 512,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0d12', light: '#ffffff' }
      });
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache'
      });
      res.end(svg);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('QR error');
    }
    return;
  }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[portal]', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка портала' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = lanAddresses();
  console.log('');
  console.log('  Игротека');
  console.log(`  локально:  http://localhost:${PORT}`);
  if (addresses[0]) console.log(`  для гостей: http://${addresses[0]}:${PORT}`);
  console.log('');
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
