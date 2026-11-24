import { randomBytes } from "node:crypto";
import os from "node:os";

/** Ошибка с машинным кодом, которую можно безопасно отдать клиенту. */
export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export const COLORS = [
  "#22d3ee",
  "#a3e635",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#34d399",
  "#f97316",
  "#38bdf8",
  "#f472b6",
  "#facc15",
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(taken) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const bytes = randomBytes(4);
    let code = "";
    for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!taken(code)) return code;
  }
  throw new AppError("INTERNAL", "Не удалось создать код комнаты");
}

export function makeAdminKey() {
  return randomBytes(32).toString("hex");
}

export function makeMatchId(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `m_${stamp}_${randomBytes(2).toString("hex")}`;
}

export function colorForIndex(index) {
  return COLORS[index % COLORS.length];
}

/** Ник: 2–20 символов, без управляющих символов, пробелы схлопываются. */
export function normalizeNick(raw) {
  if (typeof raw !== "string") throw new AppError("VALIDATION", "Ник обязателен");
  const nick = raw.replace(/\s+/g, " ").trim();
  if (/[\u0000-\u001f\u007f]/.test(nick)) {
    throw new AppError("VALIDATION", "Ник содержит недопустимые символы");
  }
  const length = Array.from(nick).length;
  if (length < 2 || length > 20) {
    throw new AppError("VALIDATION", "Ник должен быть от 2 до 20 символов");
  }
  return nick;
}

export function normalizeRoomName(raw) {
  if (typeof raw !== "string") throw new AppError("VALIDATION", "Название комнаты обязательно");
  const name = raw.replace(/\s+/g, " ").trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 30) {
    throw new AppError("VALIDATION", "Название комнаты: от 2 до 30 символов");
  }
  return name;
}

/** Код комнаты: 4 символа из безопасного алфавита. */
export function normalizeCode(raw) {
  if (typeof raw !== "string") throw new AppError("VALIDATION", "Код комнаты обязателен");
  const code = raw.trim().toUpperCase();
  if (code.length !== 4 || [...code].some((ch) => !CODE_ALPHABET.includes(ch))) {
    throw new AppError("VALIDATION", "Код комнаты: 4 символа, например 7K4Q");
  }
  return code;
}

/** Идентификатор игрока приходит с клиента и живёт в localStorage. */
export function normalizePlayerId(raw) {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
    throw new AppError("VALIDATION", "Некорректный идентификатор игрока");
  }
  return raw;
}

/** IPv4-адреса этой машины в локальной сети. */
export function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) found.push({ name, address: net.address });
    }
  }

  const score = ({ name, address }) => {
    let value = 3;
    if (address.startsWith("192.168.")) value = 0;
    else if (address.startsWith("10.")) value = 1;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) value = 2;
    if (/vEthernet|VirtualBox|VMware|Tailscale|ZeroTier|WSL|Hyper-V/i.test(name)) value += 10;
    return value;
  };

  return [...new Set(found.sort((a, b) => score(a) - score(b)).map((item) => item.address))];
}

/** Монотонное время сервера для таймингов. */
export function nowMs() {
  return performance.now();
}

export function formatGap(ms) {
  return `${(ms / 1000).toFixed(2)} с`;
}
