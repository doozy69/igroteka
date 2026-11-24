import { call, ensurePlayerId, saveNick, socket } from "./socket.js";
import { avatar, el, formatClock, formatDuration, formatGap, icon, plural } from "./dom.js";
import { buildAdminPanel, cancelDraftTimer, resetDraft } from "./admin.js";
import { isSoundsEnabled, playClick, playCorrect, playWrong, playVictory, toggleSounds } from "./sounds.js";

const code = (location.pathname.split("/")[2] ?? "").toUpperCase();
const playerId = ensurePlayerId();
const adminKey = localStorage.getItem(`quiz:admin:${code}`) ?? "";
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

let nick = localStorage.getItem("quiz:nick") ?? "";
let state = null;
let isAdmin = false;
let timerHandle = null;
let toastTimer = null;

const QFONT_KEY = "quiz:qfont";
const QFONT_MIN = 14;
const QFONT_MAX = 48;
const QFONT_STEP = 2;
const QFONT_DEFAULT = 17;

function getQuestionFontSize() {
  const raw = Number(sessionStorage.getItem(QFONT_KEY));
  if (!Number.isFinite(raw)) return QFONT_DEFAULT;
  return Math.min(QFONT_MAX, Math.max(QFONT_MIN, Math.round(raw)));
}

function setQuestionFontSize(size) {
  const next = Math.min(QFONT_MAX, Math.max(QFONT_MIN, Math.round(size)));
  sessionStorage.setItem(QFONT_KEY, String(next));
  applyQuestionFontSize(next);
  return next;
}

function applyQuestionFontSize(size = getQuestionFontSize()) {
  document.querySelectorAll(".question-text").forEach((node) => {
    node.style.fontSize = `${size}px`;
  });
}

function mountFontControls() {
  if (document.querySelector(".font-bar")) return;
  const minus = el("button", { class: "font-btn", type: "button", title: "Уменьшить шрифт вопроса", "aria-label": "Уменьшить шрифт вопроса" }, "−");
  const label = el("span", { class: "font-label", text: "Текст вопроса" });
  const plus = el("button", { class: "font-btn", type: "button", title: "Увеличить шрифт вопроса", "aria-label": "Увеличить шрифт вопроса" }, "+");

  minus.addEventListener("click", () => setQuestionFontSize(getQuestionFontSize() - QFONT_STEP));
  plus.addEventListener("click", () => setQuestionFontSize(getQuestionFontSize() + QFONT_STEP));

  const bar = el("div", { class: "font-bar" }, minus, label, plus);
  document.body.append(bar);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

async function sendAdmin(action, data = {}) {
  if (action === "open" || action === "finish") cancelDraftTimer();
  // Звуки вердикта/финиша — сразу по клику, чтобы сработало в рамках жеста пользователя.
  if (action === "verdict") {
    if (isSoundsEnabled()) {
      if (data.correct) playCorrect();
      else playWrong();
    }
  }
  if (action === "finish") {
    if (isSoundsEnabled()) playVictory();
  }
  const result = await call("admin", { code, adminKey, action, data });
  if (!result.ok) {
    toast(result.error.message);
    return result;
  }
  if (action === "start" || action === "next") {
    resetDraft("");
    const input = document.getElementById("question-input");
    if (input) input.value = "";
  }
  return result;
}

async function sync() {
  if (!nick) {
    renderAskNick();
    return;
  }
  const result = await call("room:join", { code, nick, playerId, adminKey });
  if (!result.ok) {
    renderFatal(result.error.message);
    return;
  }
  isAdmin = Boolean(result.data.isAdmin);
  state = result.data.state;
  render();
}

function myPlayer() {
  return state?.players.find((p) => p.id === playerId) ?? null;
}

function myWaitingEntry() {
  return state?.queue.find((entry) => entry.playerId === playerId && entry.status === "waiting") ?? null;
}

function myWrongEntry() {
  return state?.queue.find((entry) => entry.playerId === playerId && entry.status === "wrong") ?? null;
}

function colorOf(id) {
  return state?.players.find((p) => p.id === id)?.color ?? "#93a1bd";
}

const PHASE_META = {
  lobby: { label: "Лобби", tone: "is-violet" },
  question: { label: "Вопрос", tone: "is-violet" },
  buzz_open: { label: "Приём ответов", tone: "is-live" },
  result: { label: "Итог раунда", tone: "is-amber" },
  finished: { label: "Финиш", tone: "is-amber" },
};

function iconButton(name, title, onClick, extraClass = "") {
  return el(
    "button",
    { class: `icon-btn ${extraClass}`.trim(), type: "button", title, "aria-label": title, onClick },
    icon(name, 18),
  );
}

function header() {
  const mine = myPlayer();
  const meta = PHASE_META[state?.phase] ?? { label: "Комната", tone: "" };
  const phaseLabel = state?.round ? `Раунд ${state.round} · ${meta.label}` : meta.label;
  const soundOn = isSoundsEnabled();

  const soundBtn = el(
    "button",
    {
      class: "icon-btn",
      type: "button",
      title: soundOn ? "Звуки: вкл" : "Звуки: выкл",
      "aria-label": soundOn ? "Выключить звуки" : "Включить звуки",
      onClick: () => {
        const on = toggleSounds();
        soundBtn.replaceChildren(icon(on ? "volume" : "volumeOff", 18));
        soundBtn.title = on ? "Звуки: вкл" : "Звуки: выкл";
        soundBtn.setAttribute("aria-label", on ? "Выключить звуки" : "Включить звуки");
      },
    },
    icon(soundOn ? "volume" : "volumeOff", 18),
  );

  const subbar = el(
    "div",
    { class: "room-subbar" },
    el("span", { class: `phase-pill ${meta.tone}` }, el("span", { class: "dot" }), phaseLabel),
    el("div", { class: "spacer" }),
    isAdmin
      ? iconButton("tv", "Открыть табло на ТВ", () =>
          window.open(`${location.origin}/r/${code}/tv`, "_blank", "noopener"),
        )
      : null,
    soundBtn,
    iconButton("close", "Выйти из комнаты", leave, "is-danger"),
  );

  return el(
    "header",
    { class: "room-top" },
    el(
      "div",
      { class: "room-top-main" },
      el("a", { class: "icon-btn", href: "/", title: "На главную", "aria-label": "На главную" }, icon("arrowLeft", 18)),
      el(
        "div",
        { class: "room-title" },
        el(
          "span",
          { class: "room-eyebrow" },
          el("span", { class: "mono", text: code }),
          el("span", { class: "sep", text: "·" }),
          isAdmin ? "ведущий" : "игрок",
        ),
        el("span", { class: "room-name", text: state?.roomName ?? "Комната" }),
      ),
      el("div", { class: "spacer" }),
      el(
        "span",
        { class: "score-pill", title: "Ваши очки" },
        el("span", { text: "очки" }),
        el("b", { class: "mono", text: String(mine?.score ?? 0) }),
      ),
    ),
    subbar,
  );
}

async function leave() {
  if (isAdmin && !window.confirm("Выйти? Игроки останутся без ведущего.")) return;
  await call("room:leave", { code, playerId });
  location.href = "/";
}

function questionCard() {
  if (!["question", "buzz_open", "result"].includes(state.phase)) return null;
  const text = state.question || "Ведущий читает вопрос вслух";
  const tag =
    state.phase === "question" ? "приготовьтесь" : state.phase === "result" ? "итог" : "открыт";
  return el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el(
        "div",
        { class: "card-title" },
        el("span", { class: "icon-badge", "aria-hidden": "true" }, icon("bolt", 18)),
        el("h2", { text: `Вопрос · раунд ${state.round}` }),
      ),
      el("span", {
        class: state.phase === "buzz_open" ? "badge lime" : state.phase === "result" ? "badge amber" : "badge",
        text: tag,
      }),
    ),
    el("p", { class: "question-text", text, style: `font-size:${getQuestionFontSize()}px` }),
  );
}

function joinLine() {
  if (!state) return null;
  const addresses = state.joinAddresses ?? [];
  if (!addresses.length) return null;
  return el(
    "div",
    { class: "join-line" },
    icon("wifi", 16),
    el("span", { text: "Подключайтесь:" }),
    el("b", {
      class: "mono",
      title: addresses.join("\n"),
      text: addresses.length > 1 ? `${addresses[0]} (+${addresses.length - 1})` : addresses[0],
    }),
    el("span", { class: "badge", text: `код ${state.code}` }),
  );
}

function playersCard() {
  const card = el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el(
        "div",
        { class: "card-title" },
        el("span", { class: "icon-badge lime", "aria-hidden": "true" }, icon("users", 18)),
        el("h2", { text: "Игроки" }),
      ),
      el("span", { class: "badge", text: `${state.players.length} / ${state.maxPlayers}` }),
    ),
  );

  const grid = el("div", { class: "players-grid" });
  for (const player of state.players) {
    const classes = ["mini"];
    if (player.id === playerId) classes.push("is-me");
    if (player.isAdmin) classes.push("is-admin");
    if (player.online === false) classes.push("is-offline");
    const role = player.isAdmin ? "ведущий" : "игрок";
    const pill = el(
      "div",
      { class: classes.join(" "), title: `${player.nick} · ${role}${player.id === playerId ? " · это вы" : ""}` },
      avatar(player.color, player.nick),
      el("span", { class: "nick", text: player.nick }),
      player.id === playerId ? el("span", { class: "you", text: "вы" }) : null,
      el("b", { class: "score", text: String(player.score) }),
    );
    grid.append(pill);
  }
  card.append(grid);
  return card;
}

function queueCard() {
  if (!state.queue.length) return null;
  if (!["buzz_open", "result"].includes(state.phase)) return null;

  const card = el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el(
        "div",
        { class: "card-title" },
        el("span", { class: "icon-badge", "aria-hidden": "true" }, icon("bolt", 18)),
        el("h2", { text: "Очередь" }),
      ),
      el("span", {
        class: state.phase === "buzz_open" ? "badge lime" : "badge amber",
        text: state.phase === "buzz_open" ? "нажмите первым" : "итог раунда",
      }),
    ),
  );

  const list = el("div", { class: "queue" });
  state.queue.forEach((entry, index) => {
    const classes = ["qitem"];
    if (entry.id === state.leaderId) classes.push("leader");
    if (entry.status === "correct") classes.push("correct");
    if (entry.status === "wrong") classes.push("wrong");

    const marker = entry.status === "correct" ? "✓" : entry.status === "wrong" ? "✗" : "";
    const baseId = state.leaderId ?? state.queue.find((item) => item.status === "correct")?.id ?? state.queue[0]?.id;
    const time =
      entry.id === baseId
        ? formatGap(entry.deltaMs)
        : entry.status === "wrong"
          ? formatGap(entry.deltaMs)
          : `+${formatGap(entry.gapMs)}`;

    const row = el(
      "div",
      { class: classes.join(" ") },
      el("span", { class: "rank", text: String(index + 1) }),
      avatar(colorOf(entry.playerId), entry.nick),
      el("span", { class: "nick", text: entry.nick }),
      el("span", { class: "time", text: marker ? `${time} ${marker}` : time }),
    );

    if (isAdmin && state.phase === "buzz_open" && entry.id === state.leaderId) {
      row.append(
        el(
          "div",
          { class: "verdict-row" },
          el(
            "button",
            {
              class: "btn btn-lime btn-sm",
              type: "button",
              style: "flex:1",
              onClick: () => sendAdmin("verdict", { entryId: entry.id, correct: true }),
            },
            "Верно +1",
          ),
          el(
            "button",
            {
              class: "btn btn-rose btn-sm",
              type: "button",
              style: "flex:1",
              onClick: () => sendAdmin("verdict", { entryId: entry.id, correct: false }),
            },
            "Неверно",
          ),
        ),
      );
    }

    list.append(row);
  });

  card.append(list);
  return card;
}

function bigButton(label, hint, disabled, onClick) {
  return el("button", { class: "big-buzz", type: "button", disabled, onClick }, label, el("span", { text: hint }));
}

function actionArea() {
  switch (state.phase) {
    case "lobby":
      return el(
        "section",
        { class: "card center lobby-card" },
        el("span", { class: "eyebrow" }, el("span", { class: "status-dot" }), "ожидание игроков"),
        el("h2", { text: "Лобби открыто" }),
        el("p", {
          class: "small",
          text: "Поделитесь кодом комнаты с друзьями. Ведущий начнёт игру, когда все подключатся.",
        }),
        el("div", { class: "lobby-code" }, el("span", { text: "код комнаты" }), el("b", { class: "mono", text: state.code })),
      );

    case "question":
      if (isAdmin) return null;
      return bigButton("Ждите сигнала", "ведущий читает вопрос", true);

    case "buzz_open": {
      if (isAdmin) return null;
      const mine = myWaitingEntry();
      if (mine) {
        const place = state.queue.findIndex((entry) => entry.id === mine.id) + 1;
        return el(
          "div",
          { class: "buzz-status" },
          el("div", { class: "pos", text: `Вы №${place}` }),
          el("strong", { class: "mono", text: place === 1 ? formatGap(mine.deltaMs) : `+${formatGap(mine.gapMs)}` }),
          el("div", { class: "small", text: "Ждём вердикта ведущего" }),
        );
      }
      if (myWrongEntry()) {
        return el(
          "div",
          { class: "result-card wrong" },
          el("strong", { text: "Неверно" }),
          el("div", { class: "small", text: "Ход перешёл следующему. Ждите итог раунда." }),
        );
      }
      return bigButton("Я ЗНАЮ!", "нажми первым", false, async () => {
        playClick();
        const result = await call("buzz", { code, playerId });
        if (!result.ok) toast(result.error.message);
      });
    }

    case "result": {
      const verdict = state.lastVerdict;
      const tone = verdict ? (verdict.correct ? "correct" : "wrong") : "";
      return el(
        "div",
        { class: `result-card ${tone}` },
        el("strong", { text: verdict ? (verdict.correct ? `${verdict.nick}: верно +1` : `${verdict.nick}: неверно`) : "Раунд завершён" }),
        el("div", { class: "small", text: "Ждём следующий вопрос от ведущего" }),
      );
    }

    default:
      return null;
  }
}

function renderFinished() {
  clearInterval(timerHandle);
  timerHandle = null;
  document.querySelector(".font-bar")?.remove();

  const table = state.standings ?? [];
  const winners = table.filter((p) => p.rank === 1).map((p) => p.nick);
  const duration = (state.finishedAt ?? Date.now()) - (state.startedAt ?? Date.now());

  const fragment = document.createDocumentFragment();
  fragment.append(header());
  fragment.append(
    el(
      "section",
      { class: "finish-hero" },
      el("div", { class: "trophy-badge" }, "🏆"),
      el("span", { class: "eyebrow" }, el("span", { class: "status-dot" }), "игра завершена"),
      el("h1", {
        class: "finish-title",
        text: winners.length ? `${winners.join(", ")} — победа` : "Игра завершена",
      }),
      el(
        "div",
        { class: "match-meta" },
        el("span", { text: `${state.round} ${plural(state.round, ["раунд", "раунда", "раундов"])}` }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: `${state.players.length} ${plural(state.players.length, ["игрок", "игрока", "игроков"])}` }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: formatDuration(duration) }),
      ),
    ),
  );

  const standingsCard = el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el(
        "div",
        { class: "card-title" },
        el("span", { class: "icon-badge amber", "aria-hidden": "true" }, icon("trophy", 18)),
        el("h2", { text: "Итоговая таблица" }),
      ),
      el("span", { class: "badge amber", text: "финал" }),
    ),
  );
  for (const player of table) {
    standingsCard.append(
      el(
        "div",
        { class: `table-row has-avatar${player.rank === 1 ? " podium" : ""}` },
        el("span", { class: "rank", text: String(player.rank) }),
        avatar(player.color, player.nick),
        el("span", { class: "n", text: player.nick }),
        el("span", { class: "v", text: String(player.score) }),
      ),
    );
  }
  fragment.append(standingsCard);

  fragment.append(
    el(
      "section",
      { class: "card" },
      el(
        "div",
        { class: "row-between" },
        el(
          "div",
          { class: "card-title" },
          el("span", { class: "icon-badge", "aria-hidden": "true" }, icon("clock", 18)),
          el("span", { class: "small", text: "Длительность игры" }),
        ),
        el("span", { class: "mono", style: "font-weight:750", text: formatDuration(duration) }),
      ),
    ),
    el(
      "div",
      { class: "stack", style: "margin-top:auto" },
      el("a", { class: "btn btn-primary", href: "/" }, "Сыграть ещё"),
      el("a", { class: "btn btn-ghost", href: "/history" }, "История игр"),
    ),
  );

  app.replaceChildren(fragment);
}

function render() {
  clearInterval(timerHandle);
  timerHandle = null;

  if (!state) {
    app.replaceChildren(el("section", { class: "card", text: "Подключаемся…" }));
    return;
  }

  if (state.phase === "finished") {
    renderFinished();
    return;
  }

  const focused = document.activeElement?.id === "question-input";
  const caret = focused ? document.activeElement.selectionStart : 0;

  const fragment = document.createDocumentFragment();
  fragment.append(header());
  const question = questionCard();
  if (question) fragment.append(question);

  if (isAdmin) {
    const panel = buildAdminPanel({ state, send: sendAdmin, code });
    if (panel) fragment.append(panel);
  }

  const queue = queueCard();
  const action = actionArea();
  // Кнопка ответа у клиентов поднимается выше очереди; после нажатия кнопка и очередь меняются местами.
  const swapped = Boolean(queue && state.phase === "buzz_open" && myWaitingEntry());
  if (swapped) {
    if (queue) fragment.append(queue);
    if (action) fragment.append(action);
  } else {
    if (action) fragment.append(action);
    if (queue) fragment.append(queue);
  }
  fragment.append(playersCard());

  const join = joinLine();
  if (join) fragment.append(join);

  app.replaceChildren(fragment);

  if (focused) {
    const input = document.getElementById("question-input");
    if (input) {
      input.focus();
      input.setSelectionRange(caret, caret);
    }
  }

  applyQuestionFontSize();
  startTimer();
}

function startTimer() {
  const node = document.querySelector("[data-timer]");
  if (!node || !state?.openedAt) return;

  const offset = state.serverTime - Date.now();
  const tick = () => {
    if (!node.isConnected) {
      clearInterval(timerHandle);
      return;
    }
    node.textContent = formatClock(Date.now() + offset - state.openedAt);
  };
  tick();
  timerHandle = setInterval(tick, 200);
}

function renderAskNick() {
  const input = el("input", {
    class: "input",
    maxlength: "20",
    placeholder: "Ваш ник",
    autocomplete: "nickname",
    value: localStorage.getItem("quiz:nick") ?? "",
  });

  const submit = async () => {
    const value = input.value.trim();
    if (value.length < 2) {
      toast("Ник должен быть от 2 до 20 символов");
      input.focus();
      return;
    }
    nick = value;
    saveNick(nick);
    await call("room:join", { code, nick, playerId, adminKey }).then((result) => {
      if (!result.ok) return renderFatal(result.error.message);
      isAdmin = Boolean(result.data.isAdmin);
      state = result.data.state;
      render();
    });
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  app.replaceChildren(
    el(
      "section",
      { class: "card card-accent" },
      el(
        "a",
        { class: "brand", href: "/", style: "margin-bottom:2px" },
        el("span", { class: "brand-mark", "aria-hidden": "true" }, icon("bolt", 22)),
        el(
          "span",
          { class: "brand-text" },
          el("span", { class: "brand-name", text: "Кто быстрее" }),
          el("span", { class: "brand-tag", text: "LAN Quiz" }),
        ),
      ),
      el("span", { class: "eyebrow" }, el("span", { class: "status-dot" }), `комната ${code}`),
      el("h1", { style: "font-size:clamp(28px, 7vw, 34px)", text: "Как тебя зовут?" }),
      el("p", { class: "small", text: "Ник увидят другие игроки и ведущий. Он сохранится в этом браузере." }),
      el("div", { class: "field", style: "margin-top:4px" }, input),
      el("button", { class: "btn btn-primary", type: "button", onClick: submit }, "Войти в комнату"),
      el("a", { class: "link-muted", href: "/", style: "text-align:center;margin-top:2px" }, "На главную"),
    ),
  );
  input.focus();
}

function renderFatal(message) {
  clearInterval(timerHandle);
  app.replaceChildren(
    el(
      "section",
      { class: "card" },
      el(
        "div",
        { class: "card-title" },
        el("span", { class: "icon-badge amber", "aria-hidden": "true" }, icon("close", 18)),
        el("h2", { text: "Не получилось" }),
      ),
      el("p", { class: "small", text: message }),
      el("a", { class: "btn btn-ghost", href: "/", style: "margin-top:8px" }, "На главную"),
    ),
  );
}

function renderOffline() {
  toast("Восстанавливаем соединение…");
}

socket.on("connect", sync);
socket.on("state", (next) => {
  state = next;
  render();
});
socket.on("room:closed", () => renderFatal("Комната закрыта"));
socket.on("disconnect", renderOffline);

mountFontControls();
if (socket.connected) sync();
