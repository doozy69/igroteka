import { AppError, colorForIndex } from "./util.js";

export const PHASE = {
  LOBBY: "lobby",
  QUESTION: "question",
  BUZZ_OPEN: "buzz_open",
  RESULT: "result",
  FINISHED: "finished",
};

export const BUZZ_COOLDOWN_MS = 150;
export const MAX_QUESTION_LENGTH = 300;

export function createState({ code, roomName, now }) {
  return {
    code,
    roomName,
    phase: PHASE.LOBBY,
    round: 0,
    question: "",
    openedAt: 0,
    openedAtEpoch: null,
    seq: 0,
    players: [],
    queue: [],
    lastVerdict: null,
    roundLog: [],
    startedAtEpoch: null,
    finishedAtEpoch: null,
    lastActivity: now,
  };
}

function nickTaken(players, nick) {
  const low = nick.toLowerCase();
  return players.some((p) => p.nick.toLowerCase() === low);
}

function suggestNick(players, nick) {
  for (let i = 2; i < 100; i += 1) {
    const suffix = String(i);
    const candidate = `${nick.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`;
    if (!nickTaken(players, candidate)) return candidate;
  }
  return null;
}

export function addPlayer(state, { id, nick, isAdmin, maxPlayers, now }) {
  if (state.phase === PHASE.FINISHED) {
    throw new AppError("INVALID_STATE", "Игра уже завершена");
  }
  if (state.players.length >= maxPlayers) {
    throw new AppError("ROOM_FULL", `В комнате уже ${maxPlayers} игроков`);
  }
  if (nickTaken(state.players, nick)) {
    const suggestion = suggestNick(state.players, nick);
    const hint = suggestion ? ` Попробуйте «${suggestion}».` : "";
    throw new AppError("NICK_TAKEN", `Ник уже занят.${hint}`);
  }

  const player = {
    id,
    nick,
    color: colorForIndex(state.players.length),
    score: 0,
    correct: 0,
    buzzes: 0,
    totalMs: 0,
    isAdmin: Boolean(isAdmin),
    online: true,
    joinRound: state.round,
    lastBuzzAt: Number.NEGATIVE_INFINITY,
  };

  return { ...state, players: [...state.players, player], lastActivity: now };
}

export function startGame(state, now) {
  if (state.phase !== PHASE.LOBBY) {
    throw new AppError("INVALID_STATE", "Игра уже начата");
  }
  if (state.players.length === 0) {
    throw new AppError("INVALID_STATE", "В комнате нет игроков");
  }
  return {
    ...state,
    phase: PHASE.QUESTION,
    round: 1,
    question: "",
    queue: [],
    seq: 0,
    lastVerdict: null,
    roundLog: [],
    startedAtEpoch: Date.now(),
    lastActivity: now,
  };
}

export function setQuestion(state, text) {
  if (state.phase !== PHASE.QUESTION) {
    throw new AppError("INVALID_STATE", "Вопрос можно менять только перед приёмом ответов");
  }
  if (typeof text !== "string") throw new AppError("VALIDATION", "Текст вопроса обязателен");
  const question = text.trim();
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new AppError("VALIDATION", `Вопрос не длиннее ${MAX_QUESTION_LENGTH} символов`);
  }
  return { ...state, question, lastActivity: performance.now() };
}

export function openBuzz(state, now, questionText) {
  if (state.phase !== PHASE.QUESTION) {
    throw new AppError("INVALID_STATE", "Приём ответов уже открыт или недоступен");
  }
  let question = state.question;
  if (typeof questionText === "string") {
    question = questionText.trim().slice(0, MAX_QUESTION_LENGTH);
  }
  return {
    ...state,
    phase: PHASE.BUZZ_OPEN,
    question,
    openedAt: now,
    openedAtEpoch: Date.now(),
    queue: [],
    seq: 0,
    lastVerdict: null,
    lastActivity: now,
  };
}

export function buzz(state, playerId, now) {
  if (state.phase !== PHASE.BUZZ_OPEN) {
    throw new AppError("INVALID_STATE", "Приём ответов закрыт");
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new AppError("FORBIDDEN", "Игрок не найден в комнате");
  if (player.isAdmin) {
    throw new AppError("FORBIDDEN", "Ведущий не отвечает на вопросы — это право игроков");
  }

  if (now - player.lastBuzzAt < BUZZ_COOLDOWN_MS) {
    throw new AppError("RATE_LIMITED", "Слишком быстро");
  }
  if (state.queue.some((entry) => entry.playerId === playerId && entry.status === "waiting")) {
    throw new AppError("INVALID_STATE", "Вы уже в очереди");
  }
  if (state.queue.some((entry) => entry.playerId === playerId && entry.status === "wrong")) {
    throw new AppError("INVALID_STATE", "Вы уже отвечали в этом раунде");
  }

  const seq = state.seq + 1;
  const deltaMs = Math.max(0, Math.round(now - state.openedAt));
  const entry = { id: `e${seq}`, playerId, seq, deltaMs, status: "waiting" };

  return {
    ...state,
    seq,
    queue: [...state.queue, entry],
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, buzzes: p.buzzes + 1, lastBuzzAt: now } : p,
    ),
    lastActivity: now,
  };
}

export function leaderEntry(state) {
  return state.queue.find((entry) => entry.status === "waiting") ?? null;
}

function buzzSnapshot(state) {
  return state.queue.map((entry) => {
    const player = state.players.find((p) => p.id === entry.playerId);
    return {
      nick: player?.nick ?? "?",
      deltaMs: entry.deltaMs,
      correct: entry.status === "correct",
    };
  });
}

export function verdict(state, entryId, correct, now) {
  if (state.phase !== PHASE.BUZZ_OPEN) {
    throw new AppError("INVALID_STATE", "Сейчас нельзя ставить вердикт");
  }
  const leader = leaderEntry(state);
  if (!leader || leader.id !== entryId) {
    throw new AppError("INVALID_STATE", "Вердикт ставится только текущему лидеру");
  }
  const player = state.players.find((p) => p.id === leader.playerId);

  if (!correct) {
    return {
      ...state,
      queue: state.queue.map((entry) =>
        entry.id === entryId ? { ...entry, status: "wrong" } : entry,
      ),
      lastVerdict: {
        entryId,
        playerId: leader.playerId,
        nick: player?.nick ?? "?",
        correct: false,
        deltaMs: leader.deltaMs,
      },
      lastActivity: now,
    };
  }

  const nextQueue = state.queue.map((entry) =>
    entry.id === entryId ? { ...entry, status: "correct" } : entry,
  );
  const nextPlayers = state.players.map((p) =>
    p.id === leader.playerId
      ? { ...p, score: p.score + 1, correct: p.correct + 1, totalMs: p.totalMs + leader.deltaMs }
      : p,
  );
  const roundLogEntry = {
    index: state.round,
    question: state.question,
    winner: player?.nick ?? null,
    buzzes: buzzSnapshot({ ...state, queue: nextQueue }),
  };

  return {
    ...state,
    phase: PHASE.RESULT,
    queue: nextQueue,
    players: nextPlayers,
    roundLog: [...state.roundLog, roundLogEntry],
    lastVerdict: {
      entryId,
      playerId: leader.playerId,
      nick: player?.nick ?? "?",
      correct: true,
      deltaMs: leader.deltaMs,
    },
    lastActivity: now,
  };
}

export function closeBuzz(state, now) {
  if (state.phase !== PHASE.BUZZ_OPEN) {
    throw new AppError("INVALID_STATE", "Приём ответов не открыт");
  }
  const roundLogEntry = {
    index: state.round,
    question: state.question,
    winner: null,
    buzzes: buzzSnapshot(state),
  };
  return {
    ...state,
    phase: PHASE.RESULT,
    roundLog: [...state.roundLog, roundLogEntry],
    lastActivity: now,
  };
}

export function nextQuestion(state, now) {
  if (state.phase !== PHASE.RESULT) {
    throw new AppError("INVALID_STATE", "Следующий вопрос доступен после итога раунда");
  }
  return {
    ...state,
    phase: PHASE.QUESTION,
    round: state.round + 1,
    question: "",
    queue: [],
    seq: 0,
    lastVerdict: null,
    openedAt: 0,
    openedAtEpoch: null,
    lastActivity: now,
  };
}

export function finish(state, now) {
  if (state.phase === PHASE.FINISHED) return state;
  if (state.phase === PHASE.LOBBY) {
    throw new AppError("INVALID_STATE", "Игру ещё не начинали");
  }
  return {
    ...state,
    phase: PHASE.FINISHED,
    finishedAtEpoch: Date.now(),
    lastActivity: now,
  };
}

export function standings(state) {
  const sorted = [...state.players].sort(
    (a, b) =>
      b.score - a.score ||
      b.correct - a.correct ||
      a.totalMs - b.totalMs ||
      a.nick.localeCompare(b.nick, "ru"),
  );

  let rank = 0;
  let previous = null;
  return sorted.map((player, index) => {
    const tied =
      previous !== null &&
      previous.score === player.score &&
      previous.correct === player.correct &&
      previous.totalMs === player.totalMs;
    if (!tied) rank = index + 1;
    previous = player;
    return {
      id: player.id,
      nick: player.nick,
      color: player.color,
      score: player.score,
      correct: player.correct,
      buzzes: player.buzzes,
      totalMs: player.totalMs,
      rank,
    };
  });
}

export function findPlayer(state, playerId) {
  return state.players.find((p) => p.id === playerId) ?? null;
}

export function nickOf(state, playerId) {
  return findPlayer(state, playerId)?.nick ?? "?";
}

/** Публичный срез комнаты: без adminKey и служебных полей. */
export function toPublic(room, nowEpoch = Date.now()) {
  const state = room.state;
  const leader = leaderEntry(state);
  const gapBase = leader?.deltaMs ?? state.queue[0]?.deltaMs ?? 0;

  return {
    code: state.code,
    roomName: state.roomName,
    phase: state.phase,
    round: state.round,
    question: state.question,
    maxPlayers: room.maxPlayers,
    openedAt: state.openedAtEpoch,
    serverTime: nowEpoch,
    startedAt: state.startedAtEpoch,
    finishedAt: state.finishedAtEpoch,
    players: state.players.map((p) => ({
      id: p.id,
      nick: p.nick,
      color: p.color,
      score: p.score,
      isAdmin: p.isAdmin,
      online: p.online,
    })),
    queue: state.queue.map((entry) => ({
      id: entry.id,
      playerId: entry.playerId,
      nick: nickOf(state, entry.playerId),
      deltaMs: entry.deltaMs,
      gapMs: Math.max(0, entry.deltaMs - gapBase),
      status: entry.status,
    })),
    leaderId: leader?.id ?? null,
    lastVerdict: state.lastVerdict,
    standings: state.phase === PHASE.FINISHED ? standings(state) : null,
    rounds: state.phase === PHASE.FINISHED ? state.roundLog : null,
  };
}
