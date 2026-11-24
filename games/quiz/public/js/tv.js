import { call, socket } from "./socket.js";
import { avatar, el, formatClock, formatGap, icon, plural } from "./dom.js";

const parts = location.pathname.split("/").filter(Boolean);
const code = (parts[1] ?? "").toUpperCase();
const app = document.getElementById("app");

let state = null;
let timerHandle = null;
let status = "connecting";

const PHASE_LABEL = {
  lobby: "Ожидание игроков",
  question: "Ведущий читает вопрос",
  buzz_open: "Приём ответов открыт",
  result: "Итог раунда",
  finished: "Игра завершена",
};

function tickTimer() {
  const node = document.querySelector("[data-tv-timer]");
  if (!node || !state?.openedAt) return;
  const offset = state.serverTime - Date.now();
  const update = () => {
    if (!node.isConnected) {
      clearInterval(timerHandle);
      return;
    }
    node.textContent = formatClock(Date.now() + offset - state.openedAt);
  };
  update();
  clearInterval(timerHandle);
  timerHandle = setInterval(update, 250);
}

function scoreTable() {
  return [...(state.players ?? [])].sort((a, b) => b.score - a.score || a.nick.localeCompare(b.nick, "ru"));
}

function header() {
  const subtitle = state
    ? state.phase === "finished"
      ? `${state.roomName} · финал · ${state.players.length} ${plural(state.players.length, ["игрок", "игрока", "игроков"])}`
      : `${state.roomName} · ${state.round} раунд · ${state.players.length} ${plural(state.players.length, ["игрок", "игрока", "игроков"])}`
    : "Подключение…";

  return el(
    "header",
    { class: "tv-top" },
    el(
      "div",
      { class: "tv-brand" },
      el("span", { class: "brand-mark", "aria-hidden": "true" }, icon("bolt", 24)),
      el(
        "div",
        {},
        el("div", { class: "tv-brand-name", text: "Кто быстрее" }),
        el("div", { class: "tv-brand-sub", text: subtitle }),
      ),
    ),
    el("div", { class: "spacer" }),
    el("div", { class: "chip mono", text: code }),
  );
}

function questionBlock() {
  if (!state) return el("div", { class: "tv-question", text: "Подключаемся к комнате…" });

  if (state.phase === "finished") {
    const winners = (state.standings ?? []).filter((p) => p.rank === 1).map((p) => p.nick);
    return el(
      "div",
      { class: "tv-finish" },
      el("div", { class: "trophy-badge" }, "🏆"),
      el("span", { class: "eyebrow" }, el("span", { class: "status-dot" }), "игра завершена"),
      el("div", {
        class: "tv-question",
        text: winners.length ? `${winners.join(", ")} — победа` : "Игра завершена",
      }),
      el(
        "div",
        { class: "match-meta" },
        el("span", {
          text: `${state.players.length} ${plural(state.players.length, ["игрок", "игрока", "игроков"])}`,
        }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: `${state.round} ${plural(state.round, ["раунд", "раунда", "раундов"])}` }),
      ),
    );
  }

  let question = state.question;
  if (!question) {
    question =
      state.phase === "lobby"
        ? `Код комнаты ${code}`
        : state.phase === "finished"
          ? "Игра завершена"
          : "Вопрос читает ведущий";
  }

  const phaseBadge = el("span", {
    class: `badge${state.phase === "buzz_open" ? " lime" : state.phase === "finished" ? " amber" : ""}`,
    text: PHASE_LABEL[state.phase] ?? state.phase,
  });

  const children = [el("div", { class: "row-between" }, el("span", { class: "small", style: "font-size:18px", text: "Вопрос" }), phaseBadge)];
  children.push(el("div", { class: "tv-question", text: question }));

  if (state.phase === "buzz_open") {
    children.push(
      el(
        "div",
        { class: "tv-timer", style: "display:flex;align-items:baseline;gap:14px" },
        el("span", { class: "mono", style: "font-size:56px;font-weight:800;color:var(--cyan)", "data-tv-timer": "" }, "00:00"),
        el("span", { class: "small", style: "font-size:18px", text: "приём ответов открыт" }),
      ),
    );
  }

  if (state.phase === "result") {
    const verdict = state.lastVerdict;
    const text = verdict
      ? verdict.correct
        ? `${verdict.nick}: верно +1`
        : `${verdict.nick}: неверно`
      : "Раунд завершён без верного ответа";
    children.push(
      el(
        "div",
        { class: "result-card", style: "min-height:0;margin-top:0;align-items:flex-start;text-align:left" },
        el("strong", { text }),
        el("div", { class: "small", text: "Ведущий откроет следующий вопрос" }),
      ),
    );
  }

  return el("div", { class: "card", style: "background:transparent;border:none;padding:0;gap:16px" }, children);
}

function raceCard() {
  const entries = state?.queue ?? [];
  const card = el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el("h2", { text: "Гонка" }),
      el("span", { class: "small", text: `${entries.length} ${plural(entries.length, ["нажатие", "нажатия", "нажатий"])}` }),
    ),
  );

  if (!entries.length) {
    card.append(el("p", { class: "small", text: "Пока никто не нажал" }));
    return card;
  }

  const list = el("div", { class: "queue" });
  entries.forEach((entry, index) => {
    const classes = ["qitem"];
    if (entry.id === state.leaderId) classes.push("leader");
    if (entry.status === "correct") classes.push("correct");
    if (entry.status === "wrong") classes.push("wrong");
    const marker = entry.status === "correct" ? "✓" : entry.status === "wrong" ? "✗" : "";
    const baseId = state.leaderId ?? state.queue.find((item) => item.status === "correct")?.id ?? state.queue[0]?.id;
    const time = entry.status === "wrong" ? formatGap(entry.deltaMs) : entry.id === baseId ? formatGap(entry.deltaMs) : `+${formatGap(entry.gapMs)}`;
    list.append(
      el(
        "div",
        { class: classes.join(" ") },
        el("span", { class: "rank", text: String(index + 1) }),
        avatar(state.players.find((p) => p.id === entry.playerId)?.color ?? "#93a1bd", entry.nick),
        el("span", { class: "nick", text: entry.nick }),
        el("span", { class: "time", text: `${time}${marker ? ` ${marker}` : ""}` }),
      ),
    );
  });
  card.append(list);
  return card;
}

function scoreCard() {
  const table = state?.standings?.length ? state.standings : scoreTable();
  const card = el(
    "section",
    { class: "card", style: "gap:0;flex:1" },
    el(
      "div",
      { class: "row-between", style: "padding-bottom:8px" },
      el("h2", { text: state?.phase === "finished" ? "Итог" : "Счёт" }),
      el("span", {
        class: "small",
        text:
          state?.phase === "finished"
            ? "игра завершена"
            : `${state?.round ?? 0} ${plural(state?.round ?? 0, ["раунд", "раунда", "раундов"])}`,
      }),
    ),
  );

  if (!table.length) {
    card.append(el("p", { class: "small", text: "Игроков пока нет" }));
    return card;
  }

  table.forEach((player, index) => {
    card.append(
      el(
        "div",
        { class: "player" },
        el("span", { class: "rank", text: String(player.rank ?? index + 1) }),
        avatar(player.color, player.nick),
        el("span", { class: "nick", text: player.nick }),
        el("span", { class: "score", text: String(player.score) }),
      ),
    );
  });

  return card;
}

function buildFooter() {
  const url = state?.joinAddresses?.[0] ?? location.host;
  return el(
    "footer",
    { class: "tv-footer" },
    el(
      "div",
      { class: "tv-ip" },
      icon("wifi", 24),
      el("span", { class: "small", style: "font-size:18px" }, "Подключайтесь:"),
      el("span", { class: "mono", text: url }),
    ),
  );
}

function render() {
  if (status === "error") return;

  const side = state && (state.phase === "buzz_open" || state.phase === "result") ? raceCard() : null;

  const content = state
    ? el(
        "div",
        { class: "tv-grid" },
        el("div", { class: "tv-left" }, questionBlock()),
        el(
          "div",
          { class: "tv-right" },
          side,
          scoreCard(),
        ),
      )
    : el("section", { class: "card" }, "Подключаемся к комнате…");

  app.replaceChildren(header(), content, buildFooter());

  tickTimer();
}

function renderError(message) {
  status = "error";
  clearInterval(timerHandle);
  app.replaceChildren(
    el(
      "section",
      { class: "card" },
      el("h2", { text: "Табло не подключилось" }),
      el("p", { class: "small", text: message }),
      el("a", { class: "btn btn-ghost", href: "/", style: "margin-top:8px" }, "На главную"),
    ),
  );
}

async function watch() {
  if (!code) return renderError("В адресе нет кода комнаты.");
  const result = await call("room:watch", { code });
  if (!result.ok) {
    return renderError(
      result.error.code === "ROOM_NOT_FOUND" ? "Комната не найдена. Проверьте код." : result.error.message,
    );
  }
  state = result.data.state;
  status = "ok";
  render();
}

socket.on("connect", watch);
socket.on("state", (next) => {
  if (next.code !== code) return;
  status = "ok";
  state = next;
  render();
});
socket.on("disconnect", () => {
  const node = document.querySelector("[data-tv-timer]");
  if (node) node.textContent = "--:--";
});

if (socket.connected) watch();
