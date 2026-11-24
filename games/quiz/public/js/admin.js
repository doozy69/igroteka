import { el, plural } from "./dom.js";
import { isSoundsEnabled, playCorrect, playWrong, playVictory, toggleSounds } from "./sounds.js";

let draft = null;
let debounce = null;

export function resetDraft(value = "") {
  draft = value;
  if (debounce) clearTimeout(debounce);
  debounce = null;
}

export function cancelDraftTimer() {
  if (debounce) clearTimeout(debounce);
  debounce = null;
}

function button(label, className, onClick, extra = {}) {
  return el("button", { class: className, type: "button", onClick, ...extra }, label);
}

function confirmFinish(send) {
  if (window.confirm("Завершить игру и сохранить результат?")) send("finish");
}

export function buildAdminPanel({ state, send, code }) {
  if (!state || state.phase === "finished") return null;
  if (draft === null) draft = state.question ?? "";

  const panel = el(
    "section",
    { class: "card admin-panel" },
    el(
      "div",
      { class: "row-between" },
      el("h2", { text: "Панель ведущего" }),
      el("span", { class: "badge amber", text: "ведущий" }),
    ),
  );
  const actions = el("div", { class: "admin-actions" });

  // "Открыть ТВ" и "Звуки" перенесены в верхнюю панель комнаты.

  if (state.phase === "lobby") {
    panel.append(
      el("p", {
        class: "small",
        text: "Пригласите игроков по коду и начинайте. Вы тоже играете.",
      }),
    );
    actions.append(button("Начать игру", "btn btn-primary", () => send("start")));
  }

  if (state.phase === "question") {
    const textarea = el("textarea", {
      class: "input",
      id: "question-input",
      maxlength: "300",
      placeholder: "Текст вопроса (можно оставить пустым и читать вслух)",
    });
    textarea.value = draft;
    textarea.addEventListener("input", () => {
      draft = textarea.value;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => send("question", { question: draft }), 500);
    });

    panel.append(el("label", { for: "question-input", text: "Вопрос" }), textarea);
    actions.append(
      button("Принимаю ответы", "btn btn-primary", () => send("open", { question: draft })),
      button("Завершить игру", "btn btn-ghost btn-sm", () => confirmFinish(send)),
    );
  }

  if (state.phase === "buzz_open") {
    panel.append(
      el(
        "div",
        { class: "row-between" },
        el(
          "div",
          {},
          el("div", { class: "small", text: "Приём ответов" }),
          el("div", { class: "timer mono", "data-timer": "" }, "00:00"),
        ),
        el(
          "div",
          { style: "text-align:right" },
          el("div", {
            class: "mono",
            style: "font-size:24px;font-weight:750;color:var(--cyan)",
            text: String(state.queue.length),
          }),
          el("div", { class: "small", text: plural(state.queue.length, ["нажатие", "нажатия", "нажатий"]) }),
        ),
      ),
      el("p", { class: "small", text: "Вы тоже играете — жмите «Я знаю!» внизу." }),
    );
    actions.append(
      button("Закрыть приём ответов", "btn btn-ghost", () => send("close")),
      button("Следующий вопрос", "btn btn-primary", () => send("next"), { disabled: true }),
      button("Завершить игру", "btn btn-ghost btn-sm", () => confirmFinish(send)),
    );
  }

  if (state.phase === "result") {
    const verdict = state.lastVerdict;
    const summary = verdict
      ? verdict.correct
        ? `${verdict.nick}: верно, +1 очко`
        : `${verdict.nick}: неверно`
      : "Раунд завершён без верного ответа";

    panel.append(el("p", { class: "small", text: summary }));
    actions.append(
      button("Следующий вопрос", "btn btn-primary", () => send("next")),
      button("Завершить игру", "btn btn-ghost btn-sm", () => confirmFinish(send)),
    );
  }

  panel.append(actions);
  return panel;
}
