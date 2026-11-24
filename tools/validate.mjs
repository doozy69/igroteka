import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REQUIRED_GAME_FIELDS = [
  'id', 'title', 'tagline', 'description', 'dir', 'port',
  'players', 'duration', 'tags', 'accent', 'monogram', 'status'
];

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function checkFile(relativePath, label) {
  if (!fs.existsSync(path.join(ROOT, relativePath))) fail(`${label}: нет ${relativePath}`);
}

let registry;
try {
  registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8'));
} catch (error) {
  console.error(`[ERROR] games.json: ${error.message}`);
  process.exit(1);
}

if (!Number.isInteger(registry.port) || registry.port < 1 || registry.port > 65535) {
  fail('games.json: некорректный порт портала');
}

const games = Array.isArray(registry.games) ? registry.games : [];
if (!games.length) fail('games.json: список games пуст');

const ids = new Set();
const ports = new Map([[registry.port, 'portal']]);

for (const [index, game] of games.entries()) {
  const where = `games[${index}] (${game.id || 'без id'})`;

  for (const field of REQUIRED_GAME_FIELDS) {
    if (game[field] === undefined || game[field] === null || game[field] === '') {
      fail(`${where}: отсутствует поле ${field}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(game.id || '')) {
    fail(`${where}: id должен быть ASCII-slug в нижнем регистре`);
  }
  if (ids.has(game.id)) fail(`${where}: повторяется id`);
  ids.add(game.id);

  if (!Number.isInteger(game.port) || game.port < 8104 || game.port > 8199) {
    if (![8101, 8102, 8103].includes(game.port)) {
      fail(`${where}: порт ${game.port} вне диапазона 8101–8199`);
    }
  }
  if (ports.has(game.port)) {
    fail(`${where}: порт ${game.port} уже занят (${ports.get(game.port)})`);
  }
  ports.set(game.port, game.id);

  if (!Array.isArray(game.tags) || game.tags.length < 1) {
    fail(`${where}: tags должен быть непустым массивом`);
  }
  if (!['ready', 'soon'].includes(game.status)) {
    fail(`${where}: status должен быть ready или soon`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(game.accent || '')) {
    fail(`${where}: accent должен быть HEX-цветом`);
  }

  const dir = path.join(ROOT, game.dir || '');
  if (!fs.existsSync(dir)) {
    fail(`${where}: нет папки ${game.dir}`);
    continue;
  }

  const packageFile = path.join(dir, 'package.json');
  if (!fs.existsSync(packageFile)) {
    fail(`${where}: нет package.json`);
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      if (!pkg.scripts?.start) fail(`${where}: package.json без npm start`);
    } catch (error) {
      fail(`${where}: package.json не читается: ${error.message}`);
    }
  }

  if (!fs.existsSync(path.join(dir, 'AGENTS.md'))) {
    fail(`${where}: нет AGENTS.md`);
  }
}

checkFile('apps/portal/package.json', 'portal');
checkFile('apps/portal/server.mjs', 'portal');
checkFile('apps/portal/AGENTS.md', 'portal');
checkFile('games/_template/package.json', 'template');
checkFile('games/_template/AGENTS.md', 'template');
checkFile('docs/CONTRACT.md', 'docs');
checkFile('docs/NEW_GAME.md', 'docs');

if (errors.length) {
  console.error('');
  console.error('Проверка не пройдена:');
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error('');
  process.exit(1);
}

console.log('');
console.log('  Проверка пройдена');
console.log(`  портал: :${registry.port}`);
for (const game of games) {
  console.log(`  ${game.id.padEnd(8)} :${game.port}  ${game.status}`);
}
console.log('');
for (const warning of warnings) console.log(`  ! ${warning}`);
