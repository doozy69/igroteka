const STORAGE_KEY = "quiz:sound";

function readInitial() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {}
  return true; // по умолчанию вкл
}

let enabled = readInitial();

export function setSoundsEnabled(value) {
  enabled = value !== false;
  try { localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0"); } catch {}
}

export function isSoundsEnabled() {
  return enabled;
}

export function toggleSounds() {
  enabled = !enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0"); } catch {}
  if (enabled) primeAudio();
  return enabled;
}

let ctx = null;

async function getContext() {
  if (!enabled) return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Пробуждение аудио по жесту пользователя. */
export function primeAudio() {
  void getContext();
}

async function tone({ freq = 440, dur = 0.1, type = "sine", gain = 0.15, delay = 0 }) {
  const ac = await getContext();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gainNode = ac.createGain();
    const start = ac.currentTime + delay + 0.01;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gainNode).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  } catch {}
}

/** Короткий клик при нажатии на кнопку «Я знаю!». */
export function playClick() {
  void tone({ freq: 1500, dur: 0.05, type: "sine", gain: 0.12 });
}

/** Звук при открытии приёма ответов. */
export function playBuzz() {
  void tone({ freq: 300, dur: 0.12, type: "square", gain: 0.1 });
  void tone({ freq: 520, dur: 0.12, type: "square", gain: 0.1, delay: 0.06 });
}

/** Звук верного ответа. */
export function playCorrect() {
  void tone({ freq: 660, dur: 0.12, type: "sine", gain: 0.16 });
  void tone({ freq: 990, dur: 0.18, type: "sine", gain: 0.16, delay: 0.09 });
}

/** Звук неверного ответа. */
export function playWrong() {
  void tone({ freq: 190, dur: 0.2, type: "sawtooth", gain: 0.1 });
}

/** Финальная победная серенада. */
export function playVictory() {
  [523, 659, 784, 1047].forEach((freq, index) => {
    void tone({ freq, dur: 0.16, type: "triangle", gain: 0.15, delay: index * 0.09 });
  });
}
