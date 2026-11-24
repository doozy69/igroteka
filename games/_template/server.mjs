import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server } from 'socket.io';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const DEFAULT_PORT = 8199;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

function lanAddresses() {
  const result = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address);
    }
  }
  return result;
}

function pickLanAddress() {
  const score = (ip) => (
    ip.startsWith('192.168.') ? 0
      : ip.startsWith('10.') ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  );
  return lanAddresses().sort((a, b) => score(a) - score(b))[0] || null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    game: 'template',
    uptime: Math.round(process.uptime())
  });
});

app.get('/api/net', (_req, res) => {
  res.json({
    ip: pickLanAddress(),
    port: httpServer.address()?.port || PORT,
    addresses: lanAddresses()
  });
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

io.on('connection', (socket) => {
  socket.emit('hello', { at: Date.now() });

  socket.on('ping:send', (_payload, reply) => {
    const response = { at: Date.now(), id: socket.id };
    if (typeof reply === 'function') reply(response);
    socket.emit('ping:result', response);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const lan = pickLanAddress();
  console.log(`Шаблон игры: http://localhost:${PORT}`);
  if (lan) console.log(`Для гостей:  http://${lan}:${PORT}`);
});

function shutdown() {
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
