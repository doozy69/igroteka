/**
 * Простые синтезированные звуки для ТВ-экрана (без mp3-файлов).
 */
let ctx = null;
let enabled = true;
let masterVolume = 0.8;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, duration, type = 'sine', volume = 0.18, delay = 0) {
  if (!enabled) return;
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const peak = Math.max(0.0001, volume * masterVolume);
  const t0 = c.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

export function unlockSound() { ensureCtx(); }

export function playSound(name) {
  if (!enabled) return;
  switch (name) {
    case 'reveal':
      tone(880, 0.12, 'sine', 0.16);
      tone(1320, 0.10, 'sine', 0.10, 0.09);
      break;
    case 'strike':
      tone(140, 0.35, 'sawtooth', 0.18);
      tone(110, 0.30, 'square', 0.12, 0.05);
      break;
    case 'buzz':
      tone(880, 0.09, 'square', 0.16);
      tone(1320, 0.12, 'square', 0.12, 0.08);
      break;
    case 'control':
      [659, 880, 1108].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, i * 0.09));
      break;
    case 'duplicate':
      tone(220, 0.18, 'square', 0.18);
      tone(180, 0.24, 'sawtooth', 0.14, 0.12);
      break;
    case 'round':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, i * 0.13));
      break;
    case 'win':
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.18, i * 0.16));
      break;
    default:
      break;
  }
}

export function setSoundEnabled(value) { enabled = !!value; }
export function isSoundEnabled() { return enabled; }
export function setVolume(value) {
  const v = Number(value);
  if (Number.isFinite(v)) masterVolume = Math.max(0, Math.min(1, v));
}
