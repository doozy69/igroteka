import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import express from "express";
import { Server } from "socket.io";

import * as game from "./game.js";
import * as rooms from "./rooms.js";
import {
  AppError,
  lanAddresses,
  makeMatchId,
  normalizeCode,
  normalizeNick,
  normalizePlayerId,
  normalizeRoomName,
  nowMs,
} from "./util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(HERE, "..", "public");

function toErrorPayload(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  console.error(error);
  return { code: "INTERNAL", message: "Внутренняя ошибка сервера" };
}

function buildMatch(room) {
  const state = room.state;
  const finishedAt = state.finishedAtEpoch ?? Date.now();
  const startedAt = state.startedAtEpoch ?? finishedAt;
  const table = game.standings(state);
  return {
    id: makeMatchId(new Date(finishedAt)),
    roomCode: state.code,
    roomName: state.roomName,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: Math.max(0, finishedAt - startedAt),
    rounds: state.round,
    players: table,
    winners: table.filter((player) => player.rank === 1).map((player) => player.nick),
    roundsDetail: state.roundLog.map((round) => ({
      index: round.index,
      question: round.question,
      winner: round.winner,
      buzzes: round.buzzes.map((buzz) => ({ ...buzz })),
    })),
  };
}

export async function createApp({ config, history = null, publicDir = DEFAULT_PUBLIC_DIR }) {
  const app = express();
  app.disable("x-powered-by");

  /** Адреса, по которым телефоны в LAN могут зайти в комнату. */
  function joinInfo(code) {
    const port = config.actualPort ?? config.port;
    if (!port) return { joinAddresses: [], joinUrls: [] };
    const joinAddresses = lanAddresses().map((ip) => `${ip}:${port}`);
    return {
      joinAddresses,
      joinUrls: joinAddresses.map((address) => `http://${address}/r/${code}`),
    };
  }

  function publicState(room) {
    return { ...game.toPublic(room), ...joinInfo(room.code) };
  }

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: config.version ?? "1.0.0",
      uptime: Math.round(process.uptime()),
      rooms: rooms.roomCount(),
    });
  });

  app.get("/api/rooms", (_req, res) => {
    res.json(rooms.listRooms());
  });

  app.get("/api/history", (req, res) => {
    if (!history) return res.json({ total: 0, matches: [] });
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    return res.json(history.list({ limit, offset }));
  });

  app.get("/api/history/:id", (req, res) => {
    const match = history?.get(req.params.id);
    if (!match) return res.status(404).json({ error: "Матч не найден" });
    return res.json(match);
  });

  app.get("/api/room/:code", (req, res) => {
    let code;
    try {
      code = normalizeCode(req.params.code);
    } catch {
      return res.status(400).json({ error: "Некорректный код" });
    }
    const room = rooms.getRoom(code);
    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    return res.json({ code, roomName: room.state.roomName, phase: room.state.phase });
  });

  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.get("/history", (_req, res) => res.sendFile(path.join(publicDir, "history.html")));
  app.get("/history/:id", (_req, res) => res.sendFile(path.join(publicDir, "match.html")));
  app.get("/r/:code/tv", (_req, res) => res.sendFile(path.join(publicDir, "tv.html")));
  app.get("/r/:code", (_req, res) => res.sendFile(path.join(publicDir, "room.html")));

  app.use(express.static(publicDir, { index: false }));

  const httpServer = createHttpServer(app);
  const io = new Server(httpServer);

  function broadcast(room) {
    if (!room) return;
    room.updatedAt = Date.now();
    io.to(room.code).emit("state", publicState(room));
  }

  function requireRoom(code) {
    const room = rooms.getRoom(code);
    if (!room) throw new AppError("ROOM_NOT_FOUND", "Комната не найдена");
    return room;
  }

  function requireAdmin(room, adminKey) {
    if (typeof adminKey !== "string" || adminKey !== room.adminKey) {
      throw new AppError("FORBIDDEN", "Нет прав ведущего");
    }
  }

  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}, ack) => {
      try {
        const roomName = normalizeRoomName(payload.roomName);
        const nick = normalizeNick(payload.nick);
        const playerId = normalizePlayerId(payload.playerId);
        const room = rooms.createRoom({
          roomName,
          nick,
          playerId,
          maxPlayers: config.maxPlayers,
          now: nowMs(),
        });
        socket.data.code = room.code;
        socket.data.playerId = playerId;
        socket.join(room.code);
        broadcast(room);
        ack?.({ ok: true, data: { code: room.code, playerId, adminKey: room.adminKey } });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("room:join", (payload = {}, ack) => {
      try {
        const code = normalizeCode(payload.code);
        const playerId = normalizePlayerId(payload.playerId);
        const nick = normalizeNick(payload.nick);
        const room = rooms.joinRoom({ code, nick, playerId, now: nowMs() });
        socket.data.code = code;
        socket.data.playerId = playerId;
        socket.join(code);
        broadcast(room);
        const isAdmin = typeof payload.adminKey === "string" && payload.adminKey === room.adminKey;
        ack?.({ ok: true, data: { state: publicState(room), isAdmin } });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("room:watch", (payload = {}, ack) => {
      try {
        const code = normalizeCode(payload.code);
        const room = requireRoom(code);
        socket.join(code);
        ack?.({ ok: true, data: { state: publicState(room) } });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("room:leave", (payload = {}, ack) => {
      try {
        const code = normalizeCode(payload.code);
        const playerId = normalizePlayerId(payload.playerId);
        const room = rooms.leaveRoom(code, playerId);
        socket.leave(code);
        socket.data = {};
        if (room) broadcast(room);
        ack?.({ ok: true, data: {} });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("buzz", (payload = {}, ack) => {
      try {
        const code = normalizeCode(payload.code);
        const playerId = normalizePlayerId(payload.playerId);
        const room = requireRoom(code);
        room.state = game.buzz(room.state, playerId, nowMs());
        broadcast(room);
        ack?.({ ok: true, data: {} });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("admin", async (payload = {}, ack) => {
      try {
        const code = normalizeCode(payload.code);
        const room = requireRoom(code);
        requireAdmin(room, payload.adminKey);
        const now = nowMs();
        const data = payload.data ?? {};
        let ackData;

        switch (payload.action) {
          case "start":
            room.state = game.startGame(room.state, now);
            break;
          case "question":
            room.state = game.setQuestion(room.state, data.question ?? "");
            break;
          case "open":
            room.state = game.openBuzz(room.state, now, data.question);
            break;
          case "verdict":
            room.state = game.verdict(room.state, data.entryId, Boolean(data.correct), now);
            break;
          case "close":
            room.state = game.closeBuzz(room.state, now);
            break;
          case "next":
            room.state = game.nextQuestion(room.state, now);
            break;
          case "finish": {
            const wasFinished = room.state.phase === game.PHASE.FINISHED;
            room.state = game.finish(room.state, now);
            if (!wasFinished && history && !room.saved) {
              const match = buildMatch(room);
              const saved = await history.saveMatch(match);
              if (saved) {
                room.matchId = match.id;
                room.saved = true;
                ackData = { matchId: match.id };
              }
            }
            break;
          }
          default:
            throw new AppError("VALIDATION", "Неизвестное действие ведущего");
        }

        broadcast(room);
        ack?.({ ok: true, data: ackData ?? {} });
      } catch (error) {
        ack?.({ ok: false, error: toErrorPayload(error) });
      }
    });

    socket.on("disconnect", () => {
      const { code, playerId } = socket.data ?? {};
      if (!code || !playerId) return;
      const room = rooms.setOnline(code, playerId, false);
      if (room) broadcast(room);
    });
  });

  const cleanupTimer = setInterval(() => rooms.cleanup(), 10 * 60 * 1000);
  cleanupTimer.unref?.();

  async function close() {
    clearInterval(cleanupTimer);
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  }

  return { app, httpServer, io, close, broadcast };
}
