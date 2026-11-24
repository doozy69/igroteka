import { avatar, el, formatDate, formatDuration, formatGap, icon, plural } from "./dom.js";

const id = decodeURIComponent(location.pathname.split("/")[2] ?? "");
const app = document.getElementById("app");

function row(rank, nick, value, color) {
  return el(
    "div",
    { class: `table-row has-avatar${rank === 1 ? " podium" : ""}` },
    el("span", { class: "rank", text: String(rank) }),
    avatar(color ?? "#a78bfa", nick),
    el("span", { class: "n", text: nick }),
    el("span", { class: "v", text: String(value) }),
  );
}

function cardTitle(iconName, title, badge) {
  return el(
    "div",
    { class: "row-between" },
    el(
      "div",
      { class: "card-title" },
      el("span", { class: "icon-badge", "aria-hidden": "true" }, icon(iconName, 17)),
      el("h2", { text: title }),
    ),
    badge ? el("span", { class: "badge", text: badge }) : null,
  );
}

function render(match) {
  const winners = match.winners ?? [];
  const table = match.players ?? [];
  const detail = match.roundsDetail ?? [];

  const fragment = document.createDocumentFragment();

  fragment.append(
    el(
      "header",
      { class: "subpage-top" },
      el("a", { class: "icon-btn", href: "/history", title: "К истории", "aria-label": "К истории" }, icon("arrowLeft", 18)),
      el(
        "div",
        { class: "page-heading" },
        el("span", { class: "eyebrow" }, `матч ${match.roomCode}`),
        el("h1", { text: match.roomName }),
      ),
      el("div", { class: "spacer" }),
      el("span", { class: "badge mono", text: match.roomCode }),
    ),
    el(
      "section",
      { class: "finish-hero" },
      el("div", { class: "trophy-badge" }, "🏆"),
      el("span", { class: "eyebrow" }, el("span", { class: "status-dot" }), "завершённый матч"),
      el("h1", {
        class: "finish-title",
        text: winners.length ? `${winners.join(", ")} — победа` : "Победителей нет",
      }),
      el(
        "div",
        { class: "match-meta" },
        el("span", { text: formatDate(match.finishedAt) }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: formatDuration(match.durationMs) }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: `${match.rounds} ${plural(match.rounds, ["раунд", "раунда", "раундов"])}` }),
      ),
    ),
  );

  const standings = el(
    "section",
    { class: "card" },
    cardTitle("trophy", "Итог", "финал"),
  );
  for (const player of table) {
    standings.append(row(player.rank, player.nick, player.score, player.color));
  }
  fragment.append(standings);

  const stats = el(
    "section",
    { class: "card" },
    cardTitle("users", "Статистика", `${table.length} ${plural(table.length, ["игрок", "игрока", "игроков"])}`),
    ...table.map((player) =>
      el(
        "div",
        { class: "round-row" },
        el("span", { text: player.nick }),
        el("span", {
          class: "mono small",
          text: `верно ${player.correct} · нажатий ${player.buzzes} · ${formatGap(player.totalMs)}`,
        }),
      ),
    ),
  );
  fragment.append(stats);

  if (detail.length) {
    const rounds = el("section", { class: "card" }, cardTitle("bolt", "Раунды", `${detail.length}`));
    for (const round of detail) {
      const buzzes = (round.buzzes ?? [])
        .map((b) => `${b.nick} ${b.correct ? "✓" : "✗"} ${formatGap(b.deltaMs)}`)
        .join(" · ");
      rounds.append(
        el(
          "div",
          { class: "round-row", style: "flex-direction:column;align-items:stretch;gap:4px" },
          el(
            "div",
            { class: "row-between" },
            el("span", { text: `#${round.index} ${round.question || "Без текста вопроса"}` }),
          ),
          el("span", {
            class: "small",
            text: round.winner ? `Победитель: ${round.winner}` : "Верного ответа не было",
          }),
          buzzes ? el("span", { class: "small mono", text: buzzes }) : null,
        ),
      );
    }
    fragment.append(rounds);
  }

  fragment.append(
    el(
      "div",
      { class: "stack", style: "margin-top:auto" },
      el("a", { class: "btn btn-primary", href: "/" }, "Сыграть снова"),
      el("a", { class: "btn btn-ghost", href: "/history" }, "Вся история"),
    ),
  );

  app.replaceChildren(fragment);
}

function renderError(message) {
  app.replaceChildren(
    el(
      "section",
      { class: "card" },
      el("h2", { text: "Матч не найден" }),
      el("p", { class: "small", text: message }),
      el("a", { class: "btn btn-ghost", href: "/history", style: "margin-top:8px" }, "К истории"),
    ),
  );
}

async function load() {
  try {
    const response = await fetch(`/api/history/${encodeURIComponent(id)}`);
    if (!response.ok) {
      return renderError(
        response.status === 404 ? "Возможно, запись удалили вместе с файлом истории." : "Сервер вернул ошибку.",
      );
    }
    render(await response.json());
  } catch {
    renderError("Сервер недоступен. Проверьте, что он запущен.");
  }
}

load();
