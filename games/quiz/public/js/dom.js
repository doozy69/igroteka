const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Минимальный набор линейных иконок (Lucide-подобные), без внешних библиотек.
 * Возвращает готовый SVG-элемент, который можно вставлять в DOM.
 */
const ICONS = {
  bolt: {
    fill: true,
    parts: [["path", { d: "M13.4 2 4.8 14.1h5.2L8.9 22l8.6-12.1h-5.2L13.4 2Z" }]],
  },
  arrowLeft: {
    parts: [
      ["path", { d: "M19 12H5" }],
      ["path", { d: "m12 19-7-7 7-7" }],
    ],
  },
  chevronRight: {
    parts: [["path", { d: "m9 18 6-6-6-6" }]],
  },
  tv: {
    parts: [
      ["rect", { x: 2, y: 7, width: 20, height: 13, rx: 2 }],
      ["path", { d: "m17 2-5 5-5-5" }],
    ],
  },
  volume: {
    parts: [
      ["path", { d: "M11 5 6 9H2v6h4l5 4V5Z" }],
      ["path", { d: "M15.5 8.5a5 5 0 0 1 0 7" }],
      ["path", { d: "M18.5 5.5a9 9 0 0 1 0 13" }],
    ],
  },
  volumeOff: {
    parts: [
      ["path", { d: "M11 5 6 9H2v6h4l5 4V5Z" }],
      ["path", { d: "m16 9 5 5" }],
      ["path", { d: "m21 9-5 5" }],
    ],
  },
  close: {
    parts: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
  },
  history: {
    parts: [
      ["path", { d: "M3 12a9 9 0 1 0 2.6-6.4" }],
      ["path", { d: "M3 4v5h5" }],
      ["path", { d: "M12 8v4l3 2" }],
    ],
  },
  trophy: {
    parts: [
      ["path", { d: "M8 21h8" }],
      ["path", { d: "M12 17v4" }],
      ["path", { d: "M7 4h10v5a5 5 0 0 1-10 0V4Z" }],
      ["path", { d: "M7 5H4v2a3 3 0 0 0 3 3" }],
      ["path", { d: "M17 5h3v2a3 3 0 0 1-3 3" }],
    ],
  },
  users: {
    parts: [
      ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: 9, cy: 7, r: 4 }],
      ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
      ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
    ],
  },
  play: {
    parts: [["path", { d: "m6 3 14 9-14 9V3Z" }]],
  },
  wifi: {
    parts: [
      ["path", { d: "M5 12.6a10 10 0 0 1 14 0" }],
      ["path", { d: "M8.5 16a5.5 5.5 0 0 1 7 0" }],
      ["path", { d: "M12 20h.01" }],
    ],
  },
  clock: {
    parts: [
      ["circle", { cx: 12, cy: 12, r: 9 }],
      ["path", { d: "M12 7v5l3 2" }],
    ],
  },
};

export function icon(name, size = 18) {
  const def = ICONS[name];
  if (!def) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  if (def.fill) {
    svg.setAttribute("fill", "currentColor");
  } else {
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  for (const [tag, attrs] of def.parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "value") node.value = String(value);
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }

  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function initial(nick) {
  return Array.from(nick ?? "?")[0]?.toUpperCase() ?? "?";
}

export function avatar(color, nick) {
  return el("span", { class: "avatar", style: `background:${color}` }, initial(nick));
}

export function formatGap(ms) {
  return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(2)} с`;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function plural(count, forms) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} мин ${seconds} с` : `${seconds} с`;
}
