import { spawn, spawnSync, exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(path.join(ROOT, 'games.json'), 'utf8'));
const children = [];
let stopping = false;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error(`[ERROR] Нужен Node.js 22 или новее. Сейчас: ${process.version}`);
  process.exit(1);
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

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

function ensureDependencies(name, relativeDir) {
  const cwd = path.join(ROOT, relativeDir);
  if (!existsSync(path.join(cwd, 'package.json'))) {
    console.error(`[${name}] нет package.json в ${relativeDir}`);
    process.exit(1);
  }
  if (existsSync(path.join(cwd, 'node_modules'))) return;

  console.log(`[${name}] первый запуск: npm install…`);
  const result = spawnSync('npm install --no-audit --no-fund', {
    cwd,
    stdio: 'inherit',
    shell: true
  });
  if (result.status !== 0) {
    console.error(`[${name}] npm install завершился с ошибкой`);
    process.exit(1);
  }
}

function launch(name, relativeDir, port) {
  const cwd = path.join(ROOT, relativeDir);
  const child = spawn('npm start', {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      AUTO_OPEN: 'false'
    },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const write = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) console.log(`[${name}] ${line}`);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) console.log(`[${name}] ${buffer}`);
    });
  };

  write(child.stdout);
  write(child.stderr);

  child.on('exit', (code) => {
    if (!stopping) console.log(`[${name}] процесс завершился, код ${code}`);
  });

  children.push({ name, child });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('');
  console.log('Останавливаем игротеку…');

  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const portalPort = Number(process.env.PORTAL_PORT) || Number(registry.port) || 8080;
const games = (Array.isArray(registry.games) ? registry.games : [])
  .filter((game) => game.status !== 'soon');

const entries = [
  { name: 'portal', dir: 'apps/portal', port: portalPort },
  ...games.map((game) => ({ name: game.id, dir: game.dir, port: Number(game.port) }))
];

const busy = [];
for (const entry of entries) {
  if (!Number.isFinite(entry.port) || entry.port <= 0) {
    console.error(`[ERROR] ${entry.name}: некорректный порт в games.json`);
    process.exit(1);
  }
  if (!(await isPortFree(entry.port))) busy.push(entry);
}

if (busy.length) {
  console.error('');
  console.error('[ERROR] Эти порты уже заняты:');
  for (const entry of busy) console.error(`  ${entry.port} — ${entry.name}`);
  console.error('');
  console.error('Скорее всего, игротека уже запущена. Закройте старое окно или освободите порты.');
  process.exit(1);
}

for (const entry of entries) ensureDependencies(entry.name, entry.dir);

const lanIp = lanAddresses()[0] || null;
const publicHost = lanIp || 'localhost';
const localPortalUrl = `http://localhost:${portalPort}/`;
const portalUrl = `http://${publicHost}:${portalPort}/`;

console.log('');
console.log('  Игротека запускается');
for (const entry of entries) {
  console.log(`  ${entry.name.padEnd(8)} http://${publicHost}:${entry.port}/`);
}
if (lanIp) console.log(`  локально   ${localPortalUrl}`);
console.log('');

for (const entry of entries) launch(entry.name, entry.dir, entry.port);

let opened = false;

for (let attempt = 0; attempt < 50; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    const response = await fetch(localPortalUrl, { signal: AbortSignal.timeout(600) });
    if (response.ok && !opened) {
      opened = true;
      console.log(`  Портал готов: ${portalUrl}`);
      if (lanIp) console.log(`  локально:     ${localPortalUrl}`);
      console.log('  Ctrl+C — остановить всё');
      console.log('');
      if (process.env.NO_OPEN !== '1') {
        if (process.platform === 'win32') exec(`start "" "${portalUrl}"`);
        else if (process.platform === 'darwin') exec(`open "${portalUrl}"`);
        else exec(`xdg-open "${portalUrl}"`);
      }
      break;
    }
  } catch {
    // портал ещё поднимается
  }
}

if (!opened) {
  console.log(`  Портал не ответил за 12 секунд. Откройте вручную: ${portalUrl}`);
}
