import test from "node:test";
import assert from "node:assert/strict";

import {
  BUZZ_COOLDOWN_MS,
  PHASE,
  addPlayer,
  buzz,
  closeBuzz,
  createState,
  finish,
  leaderEntry,
  nextQuestion,
  openBuzz,
  setQuestion,
  standings,
  startGame,
  toPublic,
  verdict,
} from "../server/game.js";

function makeState() {
  let state = createState({ code: "ABCD", roomName: "Тест", now: 0 });
  state = addPlayer(state, { id: "p1", nick: "Игрок 1", maxPlayers: 12, now: 0 });
  state = addPlayer(state, { id: "p2", nick: "Игрок 2", maxPlayers: 12, now: 0 });
  state = addPlayer(state, { id: "p3", nick: "Игрок 3", maxPlayers: 12, now: 0 });
  return state;
}

function playingState({ openedAt = 1000 } = {}) {
  let state = makeState();
  state = startGame(state, 100);
  state = setQuestion(state, "Столица Австралии?");
  state = openBuzz(state, openedAt);
  return state;
}

test("создание комнаты: фаза lobby, игроки и счёт на нуле", () => {
  const state = makeState();
  assert.equal(state.phase, PHASE.LOBBY);
  assert.equal(state.players.length, 3);
  assert.deepEqual(
    state.players.map((p) => p.score),
    [0, 0, 0],
  );
  assert.equal(state.players[0].isAdmin, false);
});

test("ники уникальны, вместимость ограничена", () => {
  const state = makeState();
  assert.throws(
    () => addPlayer(state, { id: "p9", nick: "игрок 1", maxPlayers: 12, now: 0 }),
    (error) => error.code === "NICK_TAKEN" && /Игрок 12|игрок 12/.test(error.message),
  );

  const full = addPlayer(state, { id: "p9", nick: "Игрок 4", maxPlayers: 4, now: 0 });
  assert.equal(full.players.length, 4);
  assert.throws(
    () => addPlayer(full, { id: "p10", nick: "Игрок 5", maxPlayers: 4, now: 0 }),
    { code: "ROOM_FULL" },
  );
});

test("startGame доступен только из lobby и требует игроков", () => {
  const started = startGame(makeState(), 10);
  assert.equal(started.phase, PHASE.QUESTION);
  assert.equal(started.round, 1);
  assert.throws(() => startGame(started, 20), { code: "INVALID_STATE" });

  const empty = createState({ code: "ZZZZ", roomName: "Пусто", now: 0 });
  assert.throws(() => startGame(empty, 0), { code: "INVALID_STATE" });
});

test("setQuestion работает только до открытия приёма ответов", () => {
  const state = playingState();
  assert.throws(() => setQuestion(state, "Поздно"), { code: "INVALID_STATE" });

  const question = setQuestion(startGame(makeState(), 0), "  Вопрос  ");
  assert.equal(question.question, "Вопрос");

  assert.throws(
    () => setQuestion(startGame(makeState(), 0), "x".repeat(301)),
    { code: "VALIDATION" },
  );
});

test("openBuzz требует фазу question и фиксирует время", () => {
  const state = startGame(makeState(), 0);
  const open = openBuzz(state, 500, "Вопрос вслух");
  assert.equal(open.phase, PHASE.BUZZ_OPEN);
  assert.equal(open.openedAt, 500);
  assert.equal(open.question, "Вопрос вслух");
  assert.ok(open.openedAtEpoch <= Date.now());
  assert.throws(() => openBuzz(open, 600), { code: "INVALID_STATE" });
});

test("buzz: очередь по seq и deltaMs от открытия", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1200);
  state = buzz(state, "p2", 1330);
  state = buzz(state, "p3", 1500);

  assert.equal(state.seq, 3);
  assert.deepEqual(
    state.queue.map((entry) => entry.playerId),
    ["p1", "p2", "p3"],
  );
  assert.deepEqual(
    state.queue.map((entry) => entry.deltaMs),
    [200, 330, 500],
  );
  assert.equal(leaderEntry(state).playerId, "p1");
  assert.equal(state.players[0].buzzes, 1);
});

test("buzz: rate limit, повтор из очереди и после неверного ответа", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1200);
  assert.throws(() => buzz(state, "p1", 1210), { code: "RATE_LIMITED" });
  assert.throws(() => buzz(state, "p1", 1400), { code: "INVALID_STATE" });

  state = verdict(state, "e1", false, 1410);
  assert.throws(
    () => buzz(state, "p1", 1200 + BUZZ_COOLDOWN_MS),
    (error) => error.code === "INVALID_STATE" && /уже отвечали/.test(error.message),
  );
  assert.equal(state.queue.length, 1);
});

test("buzz: нельзя нажимать вне приёма и незнакомому игроку", () => {
  const lobby = makeState();
  assert.throws(() => buzz(lobby, "p1", 10), { code: "INVALID_STATE" });

  const state = playingState();
  assert.throws(() => buzz(state, "unknown", 1100), { code: "FORBIDDEN" });
});

test("verdict «неверно» передаёт очередь следующему", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1100);
  state = buzz(state, "p2", 1200);

  state = verdict(state, "e1", false, 1300);
  assert.equal(state.phase, PHASE.BUZZ_OPEN);
  assert.equal(state.queue[0].status, "wrong");
  assert.equal(state.lastVerdict.correct, false);
  assert.equal(leaderEntry(state).playerId, "p2");
  assert.throws(() => buzz(state, "p1", 1600), { code: "INVALID_STATE" });

  assert.throws(() => verdict(state, "e1", false, 1400), { code: "INVALID_STATE" });
});

test("verdict «верно»: очко, итог раунда и запись раунда", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1100);
  state = buzz(state, "p2", 1250);
  state = verdict(state, "e1", false, 1300);
  state = verdict(state, "e2", true, 1400);

  assert.equal(state.phase, PHASE.RESULT);
  assert.equal(state.lastVerdict.correct, true);
  assert.equal(state.players.find((p) => p.id === "p2").score, 1);
  assert.equal(state.players.find((p) => p.id === "p2").totalMs, 250);

  const round = state.roundLog.at(-1);
  assert.equal(round.winner, "Игрок 2");
  assert.equal(round.buzzes.length, 2);
  assert.deepEqual(
    round.buzzes.map((b) => b.correct),
    [false, true],
  );

  assert.throws(() => verdict(state, "e2", true, 1500), { code: "INVALID_STATE" });
});

test("вердикт нельзя ставить не лидеру", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1100);
  state = buzz(state, "p2", 1200);
  assert.throws(() => verdict(state, "e2", true, 1300), { code: "INVALID_STATE" });
});

test("closeBuzz завершает раунд без победителя", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1100);
  state = closeBuzz(state, 1200);

  assert.equal(state.phase, PHASE.RESULT);
  assert.equal(state.lastVerdict, null);
  assert.equal(state.roundLog.at(-1).winner, null);
  assert.throws(() => closeBuzz(state, 1300), { code: "INVALID_STATE" });
});

test("nextQuestion: новый раунд, очистка очереди и вопроса", () => {
  let state = playingState({ openedAt: 1000 });
  state = buzz(state, "p1", 1100);
  state = verdict(state, "e1", true, 1200);
  const next = nextQuestion(state, 1300);

  assert.equal(next.phase, PHASE.QUESTION);
  assert.equal(next.round, 2);
  assert.equal(next.question, "");
  assert.equal(next.queue.length, 0);
  assert.equal(next.lastVerdict, null);
  assert.equal(next.openedAtEpoch, null);
});

test("finish: только после старта, повторный вызов идемпотентен", () => {
  const lobby = makeState();
  assert.throws(() => finish(lobby, 10), { code: "INVALID_STATE" });

  const started = startGame(lobby, 10);
  const finished = finish(started, 20);
  assert.equal(finished.phase, PHASE.FINISHED);
  assert.ok(finished.finishedAtEpoch > 0);

  const again = finish(finished, 30);
  assert.equal(again, finished);
});

test("standings: тай-брейки score → correct → totalMs → ник", () => {
  const state = makeState();
  const base = { color: "#fff", buzzes: 0 };
  state.players = [
    { ...base, id: "a", nick: "Игрок 3", score: 2, correct: 2, totalMs: 900 },
    { ...base, id: "b", nick: "Игрок 2", score: 2, correct: 2, totalMs: 900 },
    { ...base, id: "c", nick: "Игрок 1", score: 2, correct: 2, totalMs: 500 },
    { ...base, id: "d", nick: "Игрок 5", score: 1, correct: 3, totalMs: 100 },
    { ...base, id: "e", nick: "Игрок 4", score: 2, correct: 1, totalMs: 100 },
  ];

  const table = standings(state);
  assert.deepEqual(
    table.map((p) => p.nick),
    ["Игрок 1", "Игрок 2", "Игрок 3", "Игрок 4", "Игрок 5"],
  );
  assert.deepEqual(
    table.map((p) => p.rank),
    [1, 2, 2, 4, 5],
  );
});

test("toPublic: только публичные данные, лидер и тайминги", () => {
  let state = startGame(makeState(), 0);
  state = setQuestion(state, "Q");
  state = openBuzz(state, 2000);
  state = buzz(state, "p2", 2150);

  const room = { maxPlayers: 12, state };
  const view = toPublic(room);

  assert.equal(view.code, "ABCD");
  assert.equal(view.phase, PHASE.BUZZ_OPEN);
  assert.equal(view.maxPlayers, 12);
  assert.equal(view.queue[0].playerId, "p2");
  assert.equal(view.queue[0].gapMs, 0);
  assert.equal(view.leaderId, view.queue[0].id);
  assert.equal(view.standings, null);
  assert.ok(view.serverTime > 0);
  assert.equal("adminKey" in view, false);
  assert.equal("lastBuzzAt" in view.players[0], false);
});
