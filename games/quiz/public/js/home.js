import { call, ensurePlayerId, saveNick, savedNick } from "./socket.js";
import { el, plural } from "./dom.js";

const playerId = ensurePlayerId();
const createForm = document.getElementById("create-form");
const joinForm = document.getElementById("join-form");
const errorEl = document.getElementById("home-error");
const roomListEl = document.getElementById("room-list");
const roomListItemsEl = document.getElementById("room-list-items");
const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
const codeInput = document.getElementById("join-code");
const joinNickInput = document.getElementById("join-nick");
const createNickInput = document.getElementById("create-nick");

const nick = savedNick();
if (nick) {
  createNickInput.value = nick;
  joinNickInput.value = nick;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

function setMode(mode, { focus = false } = {}) {
  const next = mode === "join" ? "join" : "create";
  for (const button of modeButtons) {
    const active = button.dataset.mode === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  createForm.hidden = next !== "create";
  joinForm.hidden = next !== "join";
  clearError();
  if (focus) (next === "join" ? codeInput : createNickInput).focus();
}

for (const button of modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

const params = new URLSearchParams(location.search);
const presetCode = (params.get("code") ?? "").toUpperCase();
if (presetCode) {
  codeInput.value = presetCode;
  setMode("join");
  joinNickInput.focus();
} else {
  setMode("create");
}

function setBusy(form, busy) {
  for (const control of form.querySelectorAll("button, input")) control.disabled = busy;
}

async function loadRooms() {
  if (roomListEl) roomListEl.hidden = true;
  let rooms = [];
  try {
    const response = await fetch("/api/rooms");
    if (response.ok) rooms = await response.json();
  } catch {
    rooms = [];
  }
  renderRoomList(Array.isArray(rooms) ? rooms : []);
}

function renderRoomList(rooms) {
  if (!roomListEl || !roomListItemsEl) return;
  roomListEl.hidden = rooms.length === 0;
  roomListItemsEl.replaceChildren();

  for (const room of rooms) {
    const item = el(
      "li",
      { class: "room-item" },
      el(
        "button",
        {
          class: "room-item-btn",
          type: "button",
          onClick: () => joinWithCode(room.code),
        },
        el("span", { class: "mono room-item-code", text: room.code }),
        el("span", { class: "room-item-name", text: room.roomName }),
        el(
          "span",
          { class: "small muted" },
          `${room.players ?? 0}/${room.maxPlayers ?? "?"} ${plural(room.players ?? 0, ["игрок", "игрока", "игроков"])}`,
        ),
      ),
    );
    roomListItemsEl.append(item);
  }
}

function joinWithCode(code) {
  const nickValue = joinNickInput.value.trim();
  codeInput.value = code;
  setMode("join");
  if (nickValue.length < 2) {
    joinNickInput.focus();
    return showError("Введите ник, чтобы войти");
  }
  joinForm.requestSubmit();
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  const roomName = document.getElementById("room-name").value.trim();
  const nickValue = document.getElementById("create-nick").value.trim();
  if (nickValue.length < 2) return showError("Ник должен быть от 2 до 20 символов");

  setBusy(createForm, true);
  const result = await call("room:create", { roomName, nick: nickValue, playerId });
  setBusy(createForm, false);

  if (!result.ok) return showError(result.error.message);

  saveNick(nickValue);
  localStorage.setItem(`quiz:admin:${result.data.code}`, result.data.adminKey);
  location.href = `/r/${result.data.code}`;
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  const nickValue = document.getElementById("join-nick").value.trim();
  if (code.length !== 4) return showError("Код комнаты: 4 символа");
  if (nickValue.length < 2) return showError("Ник должен быть от 2 до 20 символов");

  setBusy(joinForm, true);
  const result = await call("room:join", { code, nick: nickValue, playerId });
  setBusy(joinForm, false);

  if (!result.ok) {
    if (result.error.code === "ROOM_NOT_FOUND") {
      return showError("Комната не найдена. Проверьте код — он показывается на экране ведущего.");
    }
    return showError(result.error.message);
  }

  saveNick(nickValue);
  location.href = `/r/${code}`;
});

await loadRooms();
