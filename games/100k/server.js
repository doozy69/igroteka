const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const { GameEngine } = require('./server/game/engine');

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

function stripJsonComments(str) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < str.length && str[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function deepMerge(base, extra) {
  if (extra === undefined) return base;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra;
  const result = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const [key, value] of Object.entries(extra)) result[key] = deepMerge(result[key], value);
  return result;
}

const CONFIG_PATH = path.join(__dirname, 'game.config.json');

function loadConfig() {
  const defaults = {
    port: 8101,
    questionsDir: 'questions',
    game: {
      defaultTeams: [
        { id: 'team1', name: 'Команда 1' },
        { id: 'team2', name: 'Команда 2' }
      ],
      bigGameTarget: 200,
      maxStrikes: 3,
      allowPlayersReconnect: true,
      timers: { reverseDiscussionSec: 20, bigGamePlayer1Sec: 20, bigGamePlayer2Sec: 30 },
      reversePointsByRank: [15, 30, 60, 120, 180, 240]
    },
    sound: { enabled: true, volume: 0.8 }
  };
  try {
    if (!fs.existsSync(CONFIG_PATH)) return defaults;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return deepMerge(defaults, JSON.parse(stripJsonComments(raw)));
  } catch (e) {
    console.warn('Не удалось прочитать game.config.json:', e.message);
    return defaults;
  }
}

const CONFIG = loadConfig();
const PORT = Number(process.env.PORT) || Number(CONFIG.port) || 8101;
const PORT_SEARCH_LIMIT = 10;
let activePort = PORT;
const PUBLIC_DIR = path.join(__dirname, 'public');
const QUESTIONS_DIR = path.resolve(__dirname, CONFIG.questionsDir || 'questions');

/* ------------------------------------------------------------------ *
 * Rooms / helpers
 * ------------------------------------------------------------------ */

const rooms = new Map();
const lobbyClients = new Set();

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeId(len = 6) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}

function send(meta, type, payload) {
  if (!meta || !meta.ws || meta.ws.readyState !== WebSocket.OPEN) return;
  meta.ws.send(JSON.stringify({ type, payload }));
}

function listPacks() {
  if (!fs.existsSync(QUESTIONS_DIR)) return [];
  return fs.readdirSync(QUESTIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
    .map((file) => {
      try {
        const pack = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, file), 'utf8'));
        return { id: file, name: pack.title || file };
      } catch (e) {
        return { id: file, name: file + ' (ошибка)' };
      }
    });
}

function validatePack(pack, filename) {
  const fail = (msg) => { throw new Error(`Пак "${filename}": ${msg}`); };
  if (!pack || typeof pack !== 'object') fail('ожидается JSON-объект');
  if (!pack.title || typeof pack.title !== 'string') fail('нет поля "title"');
  if (!Array.isArray(pack.rounds) || !pack.rounds.length) fail('нет массива "rounds"');

  pack.rounds.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object') fail(`раунд #${n} некорректен`);
    if (!['simple', 'double', 'triple', 'reverse', 'big'].includes(r.type)) {
      fail(`раунд #${n}: неизвестный type "${r.type}"`);
    }
    if (r.type === 'big') {
      if (!Array.isArray(r.questions) || r.questions.length !== 5) {
        fail(`раунд #${n}: для большой игры нужно ровно 5 вопросов`);
      }
      r.questions.forEach((q, j) => {
        if (!q.text || !Array.isArray(q.answers) || !q.answers.length) {
          fail(`раунд #${n}, вопрос #${j + 1}: нет text или answers`);
        }
      });
    } else {
      if (!r.text) fail(`раунд #${n}: нет текста вопроса`);
      if (!Array.isArray(r.answers) || r.answers.length !== 6) {
        fail(`раунд #${n}: нужно ровно 6 ответов`);
      }
      r.answers.forEach((a, j) => {
        if (!a.text || typeof a.points !== 'number') {
          fail(`раунд #${n}, ответ #${j + 1}: нужны text и points`);
        }
      });
    }
  });
}

function loadPackFile(packId) {
  const safe = path.basename(String(packId || ''));
  if (!safe.toLowerCase().endsWith('.json')) throw new Error('Некорректное имя пака');
  const filePath = path.join(QUESTIONS_DIR, safe);
  if (!filePath.startsWith(QUESTIONS_DIR)) throw new Error('Некорректный путь');
  const pack = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validatePack(pack, safe);
  return pack;
}

function publicRooms() {
  return [...rooms.values()]
    .filter((room) => room.engine.phase !== 'finished')
    .map((room) => ({
      id: room.id,
      name: room.name,
      players: [...room.players.values()].filter((p) => p.connected).length,
      phase: room.engine.phase,
      packTitle: room.engine.pack ? room.engine.pack.title : null
    }));
}

function broadcastRooms() {
  const list = publicRooms();
  for (const meta of lobbyClients) send(meta, 'ROOMS_LIST', list);
}

/* ------------------------------------------------------------------ *
 * Составы, капитаны и участники розыгрыша
 * ------------------------------------------------------------------ */

function teamPlayersOf(room, teamId) {
  return [...room.players.values()].filter((p) => p.teamId === teamId);
}

/** Порядок игроков в команде. Капитан всегда первый, новые игроки — в конец. */
function syncLineups(room) {
  if (!room.lineups) room.lineups = {};
  for (const team of room.engine.teams) {
    const players = teamPlayersOf(room, team.id);
    const valid = new Set(players.map((p) => p.id));
    let order = (room.lineups[team.id] || []).filter((id) => valid.has(id));
    const seen = new Set(order);
    for (const player of players) {
      if (!seen.has(player.id)) {
        order.push(player.id);
        seen.add(player.id);
      }
    }
    const captain = room.captains && room.captains[team.id];
    if (captain && valid.has(captain)) {
      order = [captain, ...order.filter((id) => id !== captain)];
    }
    room.lineups[team.id] = order;
  }
}

function teamLineup(room, teamId) {
  syncLineups(room);
  return room.lineups[teamId] || [];
}

function ensureCaptain(room, teamId) {
  if (!room.captains) room.captains = {};
  syncLineups(room);
  const players = teamPlayersOf(room, teamId);
  const current = room.captains[teamId];
  if (current && players.some((p) => p.id === current)) return current;
  const first = (room.lineups[teamId] || [])[0] || null;
  room.captains[teamId] = first;
  return first;
}

function ensureAllCaptains(room) {
  if (!room.captains) room.captains = {};
  syncLineups(room);
  for (const team of room.engine.teams) ensureCaptain(room, team.id);
}

/** Участник по позиции в составе; уже игравших в розыгрыше пропускаем. */
function pickFaceoffPlayer(room, teamId, nominalIndex) {
  const lineup = teamLineup(room, teamId);
  if (!lineup.length) return null;
  const history = room.faceoffHistory || new Set();
  const start = Math.min(nominalIndex, lineup.length - 1);
  const candidate = lineup[start];
  if (!history.has(candidate)) return candidate;
  for (let step = 1; step < lineup.length; step++) {
    const next = lineup[(start + step) % lineup.length];
    if (!history.has(next)) return next;
  }
  return candidate;
}

function defaultFaceoffParticipants(room) {
  const type = room.engine.currentQuestion ? room.engine.currentQuestion.type : 'simple';
  const participants = {};
  for (const team of room.engine.teams) {
    const lineup = teamLineup(room, team.id);
    if (type === 'simple') {
      participants[team.id] = room.captains[team.id] || lineup[0] || null;
    } else {
      participants[team.id] = pickFaceoffPlayer(room, team.id, type === 'triple' ? 2 : 1);
    }
  }
  return participants;
}

function nextFaceoffParticipants(room) {
  const current = (room.engine.faceoff && room.engine.faceoff.participants) || {};
  const participants = {};
  for (const team of room.engine.teams) {
    const lineup = teamLineup(room, team.id);
    if (!lineup.length) {
      participants[team.id] = null;
      continue;
    }
    const idx = current[team.id] ? lineup.indexOf(current[team.id]) : -1;
    participants[team.id] = lineup[(idx + 1) % lineup.length];
  }
  return participants;
}

function repairFaceoffParticipants(room) {
  if (!room.engine.faceoff || room.engine.phase !== 'faceoff') return;
  let changed = false;
  for (const team of room.engine.teams) {
    const playerId = room.engine.faceoff.participants[team.id];
    const player = playerId ? room.players.get(playerId) : null;
    if (!player || player.teamId !== team.id) {
      const lineup = teamLineup(room, team.id);
      room.engine.faceoff.participants[team.id] = lineup[0] || null;
      changed = true;
    }
  }
  if (changed) room.engine.resetFaceoffBuzz(false);
}

/* ------------------------------------------------------------------ *
 * Очередь ответов в основной игре
 * ------------------------------------------------------------------ */

function clearTurn(room) {
  room.turn = null;
}

function setTurn(room, teamId, playerId) {
  const lineup = teamLineup(room, teamId);
  const index = lineup.indexOf(playerId);
  if (index < 0) return false;
  room.turn = { teamId, playerId, index };
  return true;
}

function startTurn(room, teamId, afterPlayerId = null) {
  const lineup = teamLineup(room, teamId);
  if (!lineup.length) {
    room.turn = null;
    return;
  }
  let index = 0;
  if (afterPlayerId) {
    const previous = lineup.indexOf(afterPlayerId);
    if (previous >= 0) index = (previous + 1) % lineup.length;
  }
  room.turn = { teamId, playerId: lineup[index], index };
}

function advanceTurn(room) {
  if (room.engine.phase !== 'play') return;
  const teamId = room.engine.controlTeamId || (room.turn && room.turn.teamId);
  if (!teamId) {
    room.turn = null;
    return;
  }
  const lineup = teamLineup(room, teamId);
  if (!lineup.length) {
    room.turn = null;
    return;
  }
  const current = room.turn ? lineup.indexOf(room.turn.playerId) : -1;
  const next = current >= 0 ? (current + 1) % lineup.length : 0;
  room.turn = { teamId, playerId: lineup[next], index: next };
}

function repairTurn(room) {
  if (room.engine.phase !== 'play' || !room.turn) return;
  const teamId = room.engine.controlTeamId;
  if (!teamId) {
    room.turn = null;
    return;
  }
  const player = room.players.get(room.turn.playerId);
  if (!player || player.teamId !== teamId) {
    startTurn(room, teamId);
    return;
  }
  const lineup = teamLineup(room, teamId);
  room.turn = { teamId, playerId: player.id, index: lineup.indexOf(player.id) };
}

function stateFor(meta, room) {
  const role = meta.role === 'admin' ? 'admin' : meta.role === 'display' ? 'display' : 'player';
  ensureAllCaptains(room);
  repairTurn(room);
  const engineState = room.engine.getState(role);
  const teams = engineState.teams.map((t) => ({
    ...t,
    captainId: room.captains[t.id] || null
  }));
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    teamId: p.teamId,
    connected: p.connected
  }));
  const me = meta.playerId ? players.find((p) => p.id === meta.playerId) || null : null;
  const turn = room.turn
    ? {
        ...room.turn,
        name: room.players.get(room.turn.playerId)?.name || null
      }
    : null;
  return {
    room: {
      id: room.id,
      name: room.name,
      adminOnline: !!room.admin,
      displayCount: room.displays.size
    },
    packId: room.packId || null,
    canChangeTeams: room.engine.phase === 'lobby',
    canSetCaptain: room.engine.phase !== 'finished',
    canSetFaceoff: room.engine.phase === 'faceoff',
    captains: { ...room.captains },
    lineups: { ...room.lineups },
    turn,
    ...engineState,
    teams,
    players,
    me
  };
}

function broadcastRoom(room) {
  room.lastActivity = Date.now();
  if (room.admin) send(room.admin, 'ROOM_STATE', stateFor(room.admin, room));
  for (const meta of room.displays) send(meta, 'ROOM_STATE', stateFor(meta, room));
  for (const player of room.players.values()) {
    if (player.connected && player.meta) send(player.meta, 'ROOM_STATE', stateFor(player.meta, room));
  }
  broadcastRooms();
}

function emitDisplayEvent(room, name, data = {}) {
  for (const meta of room.displays) send(meta, 'EVENT', { name, data });
}

function applyFaceoffChoice(room, index) {
  const res = room.engine.submitFaceoffChoice(index);
  if (!res.ok) return res;
  if (res.matchIndex >= 0) emitDisplayEvent(room, 'reveal');
  if (res.stage === 'done' && res.controlTeamId) {
    emitDisplayEvent(room, 'control');
    startTurn(room, res.controlTeamId, room.engine.faceoff.controlPlayerId);
  } else if (res.stage === 'repeat') {
    clearTurn(room);
  }
  broadcastRoom(room);
  return res;
}

function applyStealChoice(room, index) {
  const res = room.engine.resolveStealChoice(index);
  if (!res.ok) return res;
  emitDisplayEvent(room, res.success ? 'reveal' : 'strike');
  clearTurn(room);
  broadcastRoom(room);
  return res;
}

function touch(room) { room.lastActivity = Date.now(); }

/**
 * Первый подходящий локальный IPv4-адрес (для QR-кода, когда ТВ открыт на localhost).
 */
function pickLanAddress() {
  const list = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const ni of items || []) {
      if (ni.family === 'IPv4' && !ni.internal) list.push(ni.address);
    }
  }
  const score = (ip) => (
    ip.startsWith('192.168.') ? 0
      : ip.startsWith('10.') ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2
          : 3
  );
  list.sort((a, b) => score(a) - score(b));
  return list[0] || null;
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      status: 'ok',
      game: '100k',
      uptime: Math.round(process.uptime()),
      rooms: rooms.size
    }));
    return;
  }

  if (pathname === '/api/net') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ip: process.env.PUBLIC_HOST || pickLanAddress(), port: server.address()?.port || activePort }));
    return;
  }

  if (pathname === '/qr') {
    try {
      const text = String(url.searchParams.get('text') || `http://${req.headers.host}/`).slice(0, 1000);
      const svg = await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        width: 512,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      res.end(svg);
    } catch (e) {
      res.writeHead(500);
      res.end('QR error');
    }
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/display' || pathname === '/tv') pathname = '/display.html';
  if (pathname === '/player' || pathname === '/play') pathname = '/player.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ------------------------------------------------------------------ *
 * WebSocket
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws' });

// Ошибки слушающего сокета приходят и на WebSocketServer. Без этого
// обработчика Node печатает стек EADDRINUSE вместо понятного сообщения.
wss.on('error', (e) => {
  if (e.code === 'EADDRINUSE') return;
  console.error('Ошибка WebSocket-сервера:', e);
});

wss.on('connection', (ws) => {
  const meta = { ws, role: null, roomId: null, playerId: null, isLobby: false };

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    handleMessage(meta, msg);
  });

  ws.on('close', () => {
    if (meta.isLobby) lobbyClients.delete(meta);
    const room = meta.roomId ? rooms.get(meta.roomId) : null;
    if (room) {
      if (room.admin === meta) room.admin = null;
      if (meta.role === 'display') room.displays.delete(meta);
      if (meta.role === 'player' && meta.playerId) {
        const player = room.players.get(meta.playerId);
        if (player) {
          player.connected = false;
          player.meta = null;
        }
      }
      broadcastRoom(room);
    }
    broadcastRooms();
  });

  ws.send(JSON.stringify({ type: 'HELLO', payload: { ok: true } }));
});

function getAdminRoom(meta) {
  if (meta.role !== 'admin' || !meta.roomId) return null;
  const room = rooms.get(meta.roomId);
  if (!room || room.admin !== meta) return null;
  return room;
}

function getPlayerRoom(meta) {
  if (meta.role !== 'player' || !meta.roomId || !meta.playerId) return null;
  const room = rooms.get(meta.roomId);
  if (!room) return null;
  const player = room.players.get(meta.playerId);
  if (!player) return null;
  return { room, player };
}

function handleMessage(meta, msg) {
  const { type, payload = {} } = msg;
  try {
    switch (type) {
      case 'LOBBY_SUBSCRIBE': {
        meta.isLobby = true;
        lobbyClients.add(meta);
        send(meta, 'ROOMS_LIST', publicRooms());
        send(meta, 'PACKS_LIST', listPacks());
        send(meta, 'CONFIG', { teams: CONFIG.game.defaultTeams || [] });
        return;
      }

      case 'ADMIN_CREATE_ROOM': {
        const id = makeId(6);
        const adminToken = makeToken();
        const engine = new GameEngine(CONFIG);
        const room = {
          id,
          name: String(payload.name || '').trim().slice(0, 60) || `Игра ${id}`,
          adminToken,
          admin: null,
          displays: new Set(),
          players: new Map(),
          captains: {},
          lineups: {},
          faceoffHistory: new Set(),
          turn: null,
          engine,
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        ensureAllCaptains(room);
        rooms.set(id, room);
        send(meta, 'ROOM_CREATED', { roomId: id, adminToken });
        broadcastRooms();
        return;
      }

      case 'ADMIN_JOIN': {
        const room = rooms.get(payload.roomId);
        if (!room) return send(meta, 'ERROR', { message: 'Комната не найдена' });
        if (payload.adminToken !== room.adminToken) {
          return send(meta, 'ERROR', { message: 'Неверный токен администратора' });
        }
        room.admin = meta;
        meta.role = 'admin';
        meta.roomId = room.id;
        meta.isLobby = false;
        lobbyClients.delete(meta);
        send(meta, 'PACKS_LIST', listPacks());
        send(meta, 'ROOM_STATE', stateFor(meta, room));
        broadcastRoom(room);
        return;
      }

      case 'DISPLAY_JOIN': {
        const room = rooms.get(payload.roomId);
        if (!room) return send(meta, 'ERROR', { message: 'Комната не найдена' });
        meta.role = 'display';
        meta.roomId = room.id;
        meta.isLobby = false;
        lobbyClients.delete(meta);
        room.displays.add(meta);
        send(meta, 'ROOM_STATE', stateFor(meta, room));
        broadcastRoom(room);
        return;
      }

      case 'PLAYER_JOIN': {
        const room = rooms.get(payload.roomId);
        if (!room) return send(meta, 'ERROR', { message: 'Комната не найдена' });
        if (room.engine.phase === 'finished') return send(meta, 'ERROR', { message: 'Игра уже завершена' });

        const cleanName = String(payload.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        const teamId = payload.teamId === 'team2' ? 'team2' : 'team1';
        let player = null;

        if (payload.playerId && payload.playerToken) {
          const existing = room.players.get(payload.playerId);
          if (existing && existing.token === payload.playerToken) {
            player = existing;
            player.connected = true;
            player.meta = meta;
            if (cleanName) player.name = cleanName;
            if (payload.teamId && room.engine.phase === 'lobby') player.teamId = teamId;
          }
        }

        if (!player) {
          if (!cleanName) return send(meta, 'ERROR', { message: 'Введите имя' });
          player = {
            id: makeId(8),
            token: makeToken(),
            name: cleanName,
            teamId,
            connected: true,
            meta
          };
          room.players.set(player.id, player);
        }

        ensureAllCaptains(room);
        repairFaceoffParticipants(room);

        meta.role = 'player';
        meta.roomId = room.id;
        meta.playerId = player.id;
        meta.isLobby = false;
        lobbyClients.delete(meta);
        send(meta, 'JOINED', {
          roomId: room.id,
          playerId: player.id,
          playerToken: player.token,
          name: player.name,
          teamId: player.teamId
        });
        broadcastRoom(room);
        return;
      }

      case 'PLAYER_SET_TEAM': {
        const ctx = getPlayerRoom(meta);
        if (!ctx) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (ctx.room.engine.phase !== 'lobby') {
          return send(meta, 'ERROR', { message: 'Составы зафиксированы — игра уже началась.' });
        }
        const teamId = String(payload.teamId || '');
        if (!ctx.room.engine.teams.some((t) => t.id === teamId)) {
          return send(meta, 'ERROR', { message: 'Неизвестная команда' });
        }
        if (ctx.player.teamId !== teamId) {
          const from = ctx.player.teamId;
          ctx.player.teamId = teamId;
          ensureAllCaptains(ctx.room);
          ctx.room.engine.logEvent('PLAYER_MOVED', {
            name: ctx.player.name,
            from,
            to: teamId,
            by: 'player'
          });
        }
        send(meta, 'TEAM_CHANGED', { teamId });
        broadcastRoom(ctx.room);
        return;
      }

      case 'PLAYER_BUZZ': {
        const ctx = getPlayerRoom(meta);
        if (!ctx) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = ctx.room.engine.buzz(ctx.player.teamId, ctx.player.id);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        if (!ctx.room.faceoffHistory) ctx.room.faceoffHistory = new Set();
        Object.values(ctx.room.engine.faceoff.participants)
          .filter(Boolean)
          .forEach((id) => ctx.room.faceoffHistory.add(id));
        emitDisplayEvent(ctx.room, 'buzz');
        broadcastRoom(ctx.room);
        return;
      }

      case 'ADMIN_LOAD_PACK': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const pack = loadPackFile(payload.packId);
        room.packId = payload.packId;
        room.engine.loadPack(pack);
        room.faceoffHistory = new Set();
        clearTurn(room);
        ensureAllCaptains(room);
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_START_ROUND': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase === 'big' && room.engine.big && room.engine.big.stage === 'done') {
          return send(meta, 'ERROR', { message: 'Большая игра — финальный раунд. Нажмите «Завершить».' });
        }
        clearTurn(room);
        room.engine.startRound();
        if (room.engine.phase === 'faceoff') {
          room.engine.setFaceoffParticipants(defaultFaceoffParticipants(room));
        }
        emitDisplayEvent(room, room.engine.phase === 'finished' ? 'win' : 'round');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SHOW_QUESTION': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.showQuestion();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        emitDisplayEvent(room, 'question');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_ACTIVE_TEAM': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.setActiveTeam(payload.teamId);
        if (room.engine.phase === 'play') {
          startTurn(room, room.engine.controlTeamId);
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_REVEAL': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });

        if (room.engine.phase === 'faceoff' && room.engine.faceoff
          && ['answer', 'second'].includes(room.engine.faceoff.stage)) {
          const res = applyFaceoffChoice(room, payload.index);
          if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
          return;
        }

        if (room.engine.phase === 'steal') {
          const res = applyStealChoice(room, payload.index);
          if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
          return;
        }

        if (room.engine.phase === 'play') {
          const pts = room.engine.revealIndex(payload.index);
          if (pts > 0) emitDisplayEvent(room, 'reveal');
          advanceTurn(room);
          broadcastRoom(room);
          return;
        }

        return send(meta, 'ERROR', { message: 'Сейчас нельзя открывать карточку.' });
      }

      case 'ADMIN_FACEOFF_MISS': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'faceoff' || !room.engine.faceoff
          || !['answer', 'second'].includes(room.engine.faceoff.stage)) {
          return send(meta, 'ERROR', { message: 'Сейчас не время отвечать в розыгрыше.' });
        }
        const res = applyFaceoffChoice(room, -1);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        return;
      }

      case 'ADMIN_STEAL_MISS': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'steal') {
          return send(meta, 'ERROR', { message: 'Сейчас нет блиц-опроса.' });
        }
        const res = applyStealChoice(room, -1);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        return;
      }

      case 'ADMIN_ADD_STRIKE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const teamId = payload.teamId || room.engine.controlTeamId;
        room.engine.addStrike(teamId);
        emitDisplayEvent(room, 'strike');
        if (room.engine.phase === 'play' && teamId === room.engine.controlTeamId) {
          advanceTurn(room);
        } else if (room.engine.phase === 'steal') {
          clearTurn(room);
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_CLEAR_STRIKE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const wasSteal = room.engine.phase === 'steal';
        room.engine.clearStrike(payload.teamId);
        if (wasSteal && room.engine.phase === 'play') {
          startTurn(room, room.engine.controlTeamId);
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_TURN': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'play') {
          return send(meta, 'ERROR', { message: 'Очередь ответов действует в основной игре.' });
        }
        const teamId = room.engine.controlTeamId;
        const player = room.players.get(payload.playerId);
        if (!teamId || !player || player.teamId !== teamId) {
          return send(meta, 'ERROR', { message: 'Этот игрок не из отвечающей команды.' });
        }
        if (!setTurn(room, teamId, player.id)) {
          return send(meta, 'ERROR', { message: 'Игрок не найден в составе.' });
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_NEXT_TURN': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'play') {
          return send(meta, 'ERROR', { message: 'Сейчас нет основной игры.' });
        }
        advanceTurn(room);
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_AWARD_FUND': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.awardFund(payload.teamId);
        emitDisplayEvent(room, 'reveal');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_REVERSE_CHOICE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (!room.engine.reverse) {
          return send(meta, 'ERROR', { message: 'Сейчас нет игры наоборот.' });
        }
        const res = room.engine.setReverseChoice(payload.teamId, payload.index);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason || 'Не удалось выбрать версию.' });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_LOCK_REVERSE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.lockReverseChoices();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_REVEAL_REVERSE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.revealReverseCard(payload.index);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        emitDisplayEvent(room, 'reveal');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_PLAYERS': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (payload.player1Id && payload.player2Id && payload.player1Id === payload.player2Id) {
          return send(meta, 'ERROR', { message: 'Выберите двух разных игроков.' });
        }
        const p1 = payload.player1Id ? room.players.get(String(payload.player1Id)) : null;
        const p2 = payload.player2Id ? room.players.get(String(payload.player2Id)) : null;
        room.engine.setBigPlayers(
          p1 ? p1.name : (payload.player1 || ''),
          p2 ? p2.name : (payload.player2 || ''),
          p1 ? p1.id : null,
          p2 ? p2.id : null
        );
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_TIMER': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.startBigTimer(payload.player, payload.seconds);
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_TIMER_STOP': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.stopBigTimer();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_CHOICE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.submitBigChoice(payload.step, payload.qIndex, payload.choice);
        if (!res.ok) {
          if (res.duplicate) emitDisplayEvent(room, 'duplicate');
          return send(meta, 'ERROR', { message: res.reason });
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_CHECK1': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.checkBig1();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        emitDisplayEvent(room, 'reveal');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_CHECK2': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.checkBig2();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        const target = CONFIG.game.bigGameTarget || 200;
        emitDisplayEvent(room, res.total >= target ? 'win' : 'reveal');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_DUPLICATE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.logEvent('BIG_DUPLICATE_SIGNAL', {});
        emitDisplayEvent(room, 'duplicate');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_BIG_SCORE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        const res = room.engine.scoreBig();
        if (!res.ok) return send(meta, 'ERROR', { message: res.reason });
        emitDisplayEvent(room, room.engine.big.total >= (CONFIG.game.bigGameTarget || 200) ? 'win' : 'reveal');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_TEAM_NAME': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.setTeamName(payload.teamId, payload.name);
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_MOVE_PLAYER': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase === 'finished') {
          return send(meta, 'ERROR', { message: 'Игра уже завершена.' });
        }
        const player = room.players.get(payload.playerId);
        if (!player) return send(meta, 'ERROR', { message: 'Игрок не найден' });
        const teamId = String(payload.teamId || '');
        if (!room.engine.teams.some((t) => t.id === teamId)) {
          return send(meta, 'ERROR', { message: 'Неизвестная команда' });
        }
        if (player.teamId !== teamId) {
          const from = player.teamId;
          player.teamId = teamId;
          ensureAllCaptains(room);
          repairFaceoffParticipants(room);
          room.engine.logEvent('PLAYER_MOVED', {
            name: player.name,
            from,
            to: teamId,
            by: 'admin'
          });
        }
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_CAPTAIN': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase === 'finished') {
          return send(meta, 'ERROR', { message: 'Игра уже завершена.' });
        }
        const teamId = String(payload.teamId || '');
        const player = room.players.get(payload.playerId);
        if (!room.engine.teams.some((t) => t.id === teamId)) {
          return send(meta, 'ERROR', { message: 'Неизвестная команда' });
        }
        if (!player || player.teamId !== teamId) {
          return send(meta, 'ERROR', { message: 'Игрок не найден в этой команде' });
        }
        const oldCaptain = room.captains[teamId];
        room.captains[teamId] = player.id;
        syncLineups(room);
        if (room.engine.phase === 'faceoff' && room.engine.faceoff) {
          if (room.engine.faceoff.participants[teamId] === oldCaptain
            || !room.engine.faceoff.participants[teamId]) {
            room.engine.faceoff.participants[teamId] = player.id;
          }
          room.engine.resetFaceoffBuzz(false);
        }
        room.engine.logEvent('CAPTAIN_SET', { teamId, playerId: player.id, name: player.name });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_REORDER_LINEUP': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase === 'finished') {
          return send(meta, 'ERROR', { message: 'Игра уже завершена.' });
        }
        const teamId = String(payload.teamId || '');
        if (!room.engine.teams.some((t) => t.id === teamId)) {
          return send(meta, 'ERROR', { message: 'Неизвестная команда' });
        }
        const direction = payload.direction === 'up' ? 'up' : 'down';
        const lineup = teamLineup(room, teamId);
        const index = lineup.indexOf(String(payload.playerId || ''));
        if (index < 0) return send(meta, 'ERROR', { message: 'Игрок не найден в составе' });
        if (index === 0 || lineup[index] === room.captains[teamId]) return;
        if (direction === 'up' && index <= 1) return;
        const next = direction === 'up' ? index - 1 : index + 1;
        if (next < 1 || next >= lineup.length) return;
        [lineup[index], lineup[next]] = [lineup[next], lineup[index]];
        room.lineups[teamId] = lineup;
        syncLineups(room);
        room.engine.logEvent('LINEUP_REORDERED', {
          teamId,
          playerId: lineup[next],
          direction
        });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_FACEOFF_PLAYER': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'faceoff' || !room.engine.faceoff) {
          return send(meta, 'ERROR', { message: 'Сейчас нет розыгрыша.' });
        }
        const teamId = String(payload.teamId || '');
        const player = room.players.get(payload.playerId);
        if (!room.engine.teams.some((t) => t.id === teamId)) {
          return send(meta, 'ERROR', { message: 'Неизвестная команда' });
        }
        if (!player || player.teamId !== teamId) {
          return send(meta, 'ERROR', { message: 'Игрок не найден в этой команде' });
        }
        room.engine.faceoff.participants[teamId] = player.id;
        room.engine.resetFaceoffBuzz(false);
        room.engine.logEvent('FACEOFF_PARTICIPANT_SET', {
          teamId,
          playerId: player.id,
          name: player.name
        });
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_RESET_BUZZ': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'faceoff' || !room.engine.faceoff) {
          return send(meta, 'ERROR', { message: 'Сейчас нет розыгрыша.' });
        }
        room.engine.resetFaceoffBuzz();
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_NEXT_FACEOFF': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        if (room.engine.phase !== 'faceoff' || !room.engine.faceoff) {
          return send(meta, 'ERROR', { message: 'Сейчас нет розыгрыша.' });
        }
        if (!room.faceoffHistory) room.faceoffHistory = new Set();
        Object.values(room.engine.faceoff.participants)
          .filter(Boolean)
          .forEach((id) => room.faceoffHistory.add(id));
        room.engine.setFaceoffParticipants(nextFaceoffParticipants(room));
        room.engine.resetFaceoffBuzz(false);
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_SET_SCORE': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.setTeamScore(payload.teamId, payload.score);
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_FINISH': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.finishGame();
        clearTurn(room);
        emitDisplayEvent(room, 'win');
        broadcastRoom(room);
        return;
      }

      case 'ADMIN_RESET': {
        const room = getAdminRoom(meta);
        if (!room) return send(meta, 'ERROR', { message: 'Нет доступа' });
        room.engine.resetGame();
        room.faceoffHistory = new Set();
        clearTurn(room);
        ensureAllCaptains(room);
        broadcastRoom(room);
        return;
      }

      default:
        send(meta, 'ERROR', { message: 'Неизвестное действие: ' + type });
    }
  } catch (e) {
    send(meta, 'ERROR', { message: e.message || String(e) });
  }
}

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, room] of rooms) {
    const playersOnline = [...room.players.values()].some((p) => p.connected);
    const empty = !playersOnline && !room.admin && room.displays.size === 0;
    const staleLobby = empty && now - (room.createdAt || now) > 2 * HOUR;
    const staleFinished = room.engine.phase === 'finished' && now - (room.lastActivity || room.createdAt || now) > 30 * 60 * 1000;
    if (staleLobby || staleFinished) {
      rooms.delete(id);
      changed = true;
    }
  }
  if (changed) broadcastRooms();
}, 5 * 60 * 1000).unref();

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

let portAttempt = 0;

function onListening() {
  activePort = server.address().port;
  console.log('');
  console.log('  «100 к одному» запущена');
  console.log(`  Главная:      http://localhost:${activePort}/`);
  console.log(`  Админ-панель: http://localhost:${activePort}/admin`);
  console.log('  Экран ТВ:     откройте из админ-панели');
  if (activePort !== PORT) {
    console.log(`  Порт ${PORT} был занят — выбран свободный ${activePort}.`);
  }
  console.log('');
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    portAttempt += 1;
    const nextPort = PORT + portAttempt;
    if (portAttempt >= PORT_SEARCH_LIMIT) {
      console.error('');
      console.error(`Не удалось найти свободный порт в диапазоне ${PORT}–${PORT + PORT_SEARCH_LIMIT - 1}.`);
      console.error('Закройте другой экземпляр игры или задайте свободный порт в game.config.json.');
      process.exit(1);
    }
    console.warn(`Порт ${nextPort - 1} занят — пробую ${nextPort}…`);
    activePort = nextPort;
    setTimeout(() => {
      server.listen(nextPort);
    }, 120);
    return;
  }
  throw e;
});

server.once('listening', onListening);
server.listen(PORT);
