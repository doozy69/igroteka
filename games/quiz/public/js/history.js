import { el, formatDate, icon, plural } from "./dom.js";

const PAGE = 20;
const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const moreWrap = document.getElementById("more-wrap");
const moreBtn = document.getElementById("more");

let offset = 0;
let total = 0;
let loading = false;

function matchCard(match) {
  const winner = match.winners?.[0];
  const winnerLine = winner
    ? el(
        "span",
        { class: "small" },
        "Победитель: ",
        el("span", { style: "color:var(--amber);font-weight:650", text: `${winner} — ${match.players?.[0]?.score ?? 0}` }),
      )
    : el("span", { class: "small muted", text: "Без победителя" });

  return el(
    "a",
    {
      class: "card history-card",
      href: `/history/${encodeURIComponent(match.id)}`,
      style: "text-decoration:none",
    },
    el(
      "div",
      { class: "row-between" },
      el(
        "div",
        { class: "card-title", style: "gap:9px" },
        el(
          "span",
          { class: "icon-badge amber", "aria-hidden": "true" },
          icon("trophy", 16),
        ),
        el("b", { text: match.roomName }),
      ),
      el("span", { class: "small mono", text: formatDate(match.finishedAt) }),
    ),
    el(
      "div",
      { class: "row-between" },
      winnerLine,
      el("span", {
        class: "small",
        text: `${match.players?.length ?? 0} ${plural(match.players?.length ?? 0, ["игрок", "игрока", "игроков"])} · ${match.rounds} ${plural(match.rounds, ["раунд", "раунда", "раундов"])}`,
      }),
    ),
  );
}

async function load(reset = false) {
  if (loading) return;
  loading = true;
  moreBtn.disabled = true;
  if (reset) {
    offset = 0;
    listEl.replaceChildren();
  }

  try {
    const response = await fetch(`/api/history?limit=${PAGE}&offset=${offset}`);
    if (!response.ok) throw new Error("bad response");
    const data = await response.json();
    total = data.total ?? 0;
    const matches = data.matches ?? [];

    if (offset === 0 && matches.length === 0) {
      statusEl.hidden = false;
      statusEl.textContent = "Игр пока нет. Создайте комнату и завершите первую игру.";
    } else {
      statusEl.hidden = true;
    }

    for (const match of matches) listEl.append(matchCard(match));
    offset += matches.length;

    countEl.hidden = total === 0;
    countEl.textContent = `${total} ${total === 1 ? "матч" : total < 5 ? "матча" : "матчей"}`;
    moreWrap.hidden = offset >= total;
  } catch {
    statusEl.hidden = false;
    statusEl.textContent = "Не удалось загрузить историю. Проверьте, что сервер запущен.";
    moreWrap.hidden = true;
  } finally {
    loading = false;
    moreBtn.disabled = false;
  }
}

moreBtn.addEventListener("click", () => load(false));
load(true);
