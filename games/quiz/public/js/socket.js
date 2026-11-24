export const socket = io();

export function call(event, payload) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: { code: "TIMEOUT", message: "Сервер не отвечает" } });
    }, 8000);

    socket.emit(event, payload, (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(response ?? { ok: false, error: { code: "INTERNAL", message: "Пустой ответ сервера" } });
    });
  });
}

export function ensurePlayerId() {
  let id = localStorage.getItem("quiz:pid");
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = makePlayerId();
    localStorage.setItem("quiz:pid", id);
  }
  return id;
}

/**
 * UUID v4. crypto.randomUUID доступен только в secure context (localhost/https),
 * поэтому для игры по LAN-IP нужен запасной путь через getRandomValues.
 */
function makePlayerId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function savedNick() {
  return localStorage.getItem("quiz:nick") ?? "";
}

export function saveNick(nick) {
  localStorage.setItem("quiz:nick", nick);
}
