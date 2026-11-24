import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { io as ioClient } from "socket.io-client";

import { createApp } from "../server/app.js";
import { createHistory } from "../server/history.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function emit(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`таймаут события ${event}`)), 5000);
    client.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function connect(url, clients) {
  const client = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  clients.push(client);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("таймаут подключения")), 5000);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return client;
}

test("полный сценарий: create → join → раунд → finish → история", async (t) => {
  const dir = path.join(HERE, ".tmp");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const historyFile = path.join(dir, "history.test.json");

  const history = await createHistory({ file: historyFile, limit: 10 });
  const config = { maxPlayers: 12, version: "test" };
  const { httpServer, close } = await createApp({ config, history });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();
  config.actualPort = port;
  const url = `http://127.0.0.1:${port}`;
  const clients = [];

  t.after(async () => {
    for (const client of clients) client.disconnect();
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  const admin = await connect(url, clients);
  const created = await emit(admin, "room:create", {
    roomName: "Интеграция",
    nick: "Ведущий",
    playerId: "admin-0001",
  });
  assert.equal(created.ok, true, created.error?.message);
  const { code, adminKey } = created.data;
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.ok(adminKey.length >= 32);

  const players = [];
  for (const [index, nick] of ["Игрок 1", "Игрок 2", "Игрок 3"].entries()) {
    const client = await connect(url, clients);
    const playerId = `player-000${index + 1}`;
    const joined = await emit(client, "room:join", { code, nick, playerId });
    assert.equal(joined.ok, true, joined.error?.message);
    players.push({ client, playerId, nick });
  }

  const joinedState = await emit(admin, "room:watch", { code });
  assert.equal(joinedState.ok, true);
  assert.equal(joinedState.data.state.players.length, 4);
  assert.ok(Array.isArray(joinedState.data.state.joinAddresses));
  for (const address of joinedState.data.state.joinAddresses) {
    assert.match(address, new RegExp(`^\\d+\\.\\d+\\.\\d+\\.\\d+:${port}$`));
  }

  const missing = await emit(players[0].client, "room:join", {
    code: "ZZZZ",
    nick: "Никто",
    playerId: "player-9999",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "ROOM_NOT_FOUND");

  const forbidden = await emit(admin, "admin", { code, adminKey: "wrong", action: "start" });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, "FORBIDDEN");

  const earlyBuzz = await emit(players[0].client, "buzz", { code, playerId: players[0].playerId });
  assert.equal(earlyBuzz.ok, false);
  assert.equal(earlyBuzz.error.code, "INVALID_STATE");

  await t.test("старт, вопрос и приём ответов", async () => {
    const started = await emit(admin, "admin", { code, adminKey, action: "start" });
    assert.equal(started.ok, true, started.error?.message);

    const question = await emit(admin, "admin", {
      code,
      adminKey,
      action: "question",
      data: { question: "Столица Австралии?" },
    });
    assert.equal(question.ok, true, question.error?.message);

    const opened = await emit(admin, "admin", {
      code,
      adminKey,
      action: "open",
      data: { question: "Столица Австралии?" },
    });
    assert.equal(opened.ok, true, opened.error?.message);

    const watched = await emit(admin, "room:watch", { code });
    assert.equal(watched.data.state.phase, "buzz_open");
    assert.equal(watched.data.state.question, "Столица Австралии?");
    assert.ok(watched.data.state.openedAt > 0);
    assert.equal(typeof watched.data.state.serverTime, "number");
  });

  await t.test("очередь нажатий и вердикты", async () => {
    for (const player of players) {
      const buzzed = await emit(player.client, "buzz", { code, playerId: player.playerId });
      assert.equal(buzzed.ok, true, buzzed.error?.message);
    }

    const rapid = await emit(players[0].client, "buzz", { code, playerId: players[0].playerId });
    assert.equal(rapid.ok, false);
    assert.equal(rapid.error.code, "RATE_LIMITED");

    await new Promise((resolve) => setTimeout(resolve, 200));
    const duplicateBuzz = await emit(players[0].client, "buzz", { code, playerId: players[0].playerId });
    assert.equal(duplicateBuzz.ok, false);
    assert.equal(duplicateBuzz.error.code, "INVALID_STATE");

    const raced = await emit(admin, "room:watch", { code });
    const queue = raced.data.state.queue;
    assert.equal(queue.length, 3);
    assert.deepEqual(
      queue.map((entry) => entry.playerId),
      players.map((player) => player.playerId),
    );
    assert.equal(raced.data.state.leaderId, queue[0].id);

    const wrong = await emit(admin, "admin", {
      code,
      adminKey,
      action: "verdict",
      data: { entryId: queue[0].id, correct: false },
    });
    assert.equal(wrong.ok, true, wrong.error?.message);

    const afterWrong = await emit(admin, "room:watch", { code });
    assert.equal(afterWrong.data.state.queue[0].status, "wrong");
    assert.equal(afterWrong.data.state.leaderId, queue[1].id);

    const correct = await emit(admin, "admin", {
      code,
      adminKey,
      action: "verdict",
      data: { entryId: queue[1].id, correct: true },
    });
    assert.equal(correct.ok, true, correct.error?.message);

    const afterCorrect = await emit(admin, "room:watch", { code });
    const state = afterCorrect.data.state;
    assert.equal(state.phase, "result");
    assert.equal(state.lastVerdict.nick, "Игрок 2");
    assert.equal(state.lastVerdict.correct, true);
    assert.equal(state.players.find((p) => p.nick === "Игрок 2").score, 1);
    assert.equal(state.standings, null);

    const repeated = await emit(admin, "admin", {
      code,
      adminKey,
      action: "verdict",
      data: { entryId: queue[1].id, correct: true },
    });
    assert.equal(repeated.ok, false);
    assert.equal(repeated.error.code, "INVALID_STATE");
  });

  await t.test("следующий раунд и завершение", async () => {
    const next = await emit(admin, "admin", { code, adminKey, action: "next" });
    assert.equal(next.ok, true, next.error?.message);

    const roundTwo = await emit(admin, "room:watch", { code });
    assert.equal(roundTwo.data.state.round, 2);
    assert.equal(roundTwo.data.state.phase, "question");

    const finished = await emit(admin, "admin", { code, adminKey, action: "finish" });
    assert.equal(finished.ok, true, finished.error?.message);
    assert.match(finished.data.matchId, /^m_/);

    const finalState = await emit(admin, "room:watch", { code });
    assert.equal(finalState.data.state.phase, "finished");
    assert.equal(finalState.data.state.standings.length, 4);

    const again = await emit(admin, "admin", { code, adminKey, action: "finish" });
    assert.equal(again.ok, true);
    assert.equal(again.data.matchId, undefined);
  });

  await t.test("история доступна по API и в файле", async () => {
    const listResponse = await fetch(`${url}/api/history?limit=10&offset=0`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.total, 1);
    assert.equal(list.matches.length, 1);

    const match = list.matches[0];
    assert.equal(match.roomCode, code);
    assert.equal(match.players.length, 4);
    assert.equal(match.rounds, 2);
    assert.deepEqual(match.winners, ["Игрок 2"]);
    assert.equal(match.players[0].nick, "Игрок 2");
    assert.equal(match.players[0].rank, 1);
    assert.equal(match.roundsDetail.length, 1);
    assert.deepEqual(
      match.roundsDetail[0].buzzes.map((b) => b.correct),
      [false, true, false],
    );

    const detailResponse = await fetch(`${url}/api/history/${encodeURIComponent(match.id)}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.id, match.id);

    const missingResponse = await fetch(`${url}/api/history/m_missing`);
    assert.equal(missingResponse.status, 404);

    const file = JSON.parse(await readFile(historyFile, "utf8"));
    assert.equal(file.version, 1);
    assert.equal(file.matches.length, 1);
    assert.equal(file.matches[0].id, match.id);
  });

  await t.test("страницы отдаются, health отвечает", async () => {
    const health = await fetch(`${url}/api/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, "ok");
    assert.equal(body.version, "test");

    for (const page of ["/", "/history", `/history/m_x`, `/r/${code}`, `/r/${code}/tv`]) {
      const response = await fetch(`${url}${page}`);
      assert.equal(response.status, 200, page);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    }

    const roomApi = await fetch(`${url}/api/room/${code}`);
    assert.equal(roomApi.status, 200);
    assert.equal((await roomApi.json()).phase, "finished");
  });

  await t.test("список открытых комнат", async () => {
    const listResponse = await fetch(`${url}/api/rooms`);
    assert.equal(listResponse.status, 200);
    const rooms = await listResponse.json();
    assert.ok(Array.isArray(rooms));
    assert.equal(rooms.length, 0);

    const created = await emit(admin, "room:create", {
      roomName: "Список комнат",
      nick: "Ведущий",
      playerId: "admin-0002",
    });
    assert.equal(created.ok, true, created.error?.message);

    const refreshed = await fetch(`${url}/api/rooms`);
    assert.equal(refreshed.status, 200);
    const list = await refreshed.json();
    assert.ok(Array.isArray(list));
    const mine = list.find((room) => room.code === created.data.code);
    assert.ok(mine, "созданная комната должна быть в списке открытых");
    assert.equal(mine.phase, "lobby");
    assert.equal(mine.players, 1);
  });
});
