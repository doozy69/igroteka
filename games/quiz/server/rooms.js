import { AppError, makeAdminKey, makeRoomCode } from "./util.js";
import { addPlayer, createState, findPlayer } from "./game.js";

const rooms = new Map();
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;

export function getRoom(code) {
  return rooms.get(code) ?? null;
}

export function createRoom({ roomName, nick, playerId, maxPlayers, now }) {
  const code = makeRoomCode((candidate) => rooms.has(candidate));
  let state = createState({ code, roomName, now });
  state = addPlayer(state, { id: playerId, nick, isAdmin: true, maxPlayers, now });

  const room = {
    code,
    adminKey: makeAdminKey(),
    maxPlayers,
    state,
    saved: false,
    matchId: null,
    updatedAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom({ code, nick, playerId, now }) {
  const room = rooms.get(code);
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Комната не найдена. Проверьте код.");

  const existing = findPlayer(room.state, playerId);
  if (existing) {
    room.state = {
      ...room.state,
      players: room.state.players.map((p) => (p.id === playerId ? { ...p, online: true } : p)),
      lastActivity: now,
    };
    room.updatedAt = Date.now();
    return room;
  }

  room.state = addPlayer(room.state, {
    id: playerId,
    nick,
    isAdmin: false,
    maxPlayers: room.maxPlayers,
    now,
  });
  room.updatedAt = Date.now();
  return room;
}

export function setOnline(code, playerId, online) {
  const room = rooms.get(code);
  if (!room) return null;
  if (!findPlayer(room.state, playerId)) return room;
  room.state = {
    ...room.state,
    players: room.state.players.map((p) => (p.id === playerId ? { ...p, online } : p)),
  };
  return room;
}

export function leaveRoom(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;
  room.state = {
    ...room.state,
    players: room.state.players.filter((p) => p.id !== playerId),
    queue: room.state.queue.filter((entry) => entry.playerId !== playerId),
  };
  room.updatedAt = Date.now();
  if (room.state.players.length === 0) {
    rooms.delete(code);
    return null;
  }
  return room;
}

export function cleanup(nowEpoch = Date.now()) {
  for (const [code, room] of rooms) {
    if (nowEpoch - room.updatedAt > IDLE_ROOM_MS) rooms.delete(code);
  }
}

export function roomCount() {
  return rooms.size;
}

/**
 * Список комнат, в которые можно зайти сейчас: не завершённые и не заполненные.
 * Сортировка по свежести обновления, максимум 20 записей.
 */
export function listRooms(limit = 20) {
  const open = [];
  for (const room of rooms.values()) {
    if (room.state.phase === "finished") continue;
    if (room.state.players.length >= room.maxPlayers) continue;
    open.push({
      code: room.code,
      roomName: room.state.roomName,
      phase: room.state.phase,
      players: room.state.players.length,
      maxPlayers: room.maxPlayers,
      updatedAt: room.updatedAt,
    });
  }
  return open.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
