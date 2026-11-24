/* Звуковое оформление игры — только для экрана ТВ (display.html).
 *
 * Сценарий -> файл задаётся в game.config.json (sound.events), сервер
 * присылает этот список при подключении. Файлы лежат в /sounds,
 * источники и лицензии — в public/sounds/CREDITS.md.
 *
 * В углу экрана — только иконка «звук вкл/выкл».
 */
(function () {
  // Резервная карта на случай, если конфиг ещё не пришёл.
  const DEFAULT_EVENTS = {
    roundStart:   { file: 'round.mp3',    volume: 0.85 },
    questionOpen: { file: 'reveal.mp3',   volume: 0.60 },
    cat:          { file: 'cat.mp3',      volume: 0.85 },
    auction:      { file: 'auction.mp3',  volume: 0.85 },
    buzz:         { file: 'buzz.mp3',     volume: 0.90 },
    correct:      { file: 'correct.mp3',  volume: 0.90 },
    wrong:        { file: 'wrong.mp3',    volume: 0.85 },
    final:        { file: 'final.mp3',    volume: 0.35, loop: true },
    finish:       { file: 'applause.mp3', volume: 0.80 }
  };
  const MUTE_KEY = 'si_sound_muted';

  let enabled = true;
  let baseVolume = 0.8;
  let muted = localStorage.getItem(MUTE_KEY) === '1';
  let events = { ...DEFAULT_EVENTS };
  let eventsSig = JSON.stringify(events);

  const cache = new Map();
  let toggle = null;

  function clamp01(n) { return Math.max(0, Math.min(1, Number(n))); }

  function normalizeEvents(next) {
    const result = {};
    for (const [name, def] of Object.entries(next || {})) {
      if (!def || typeof def !== 'object' || !def.file) continue;
      result[name] = {
        file: String(def.file),
        volume: Number.isFinite(Number(def.volume)) ? clamp01(def.volume) : 1,
        ...(def.loop ? { loop: true } : {}),
        ...(def.version ? { version: String(def.version) } : {})
      };
    }
    return result;
  }

  function ensure(name) {
    const track = events[name];
    if (!track) return null;
    let audio = cache.get(name);
    if (!audio) {
      // ?v=<mtime> — чтобы после замены файла браузер не играл старую версию из кеша
      const version = track.version ? '?v=' + encodeURIComponent(track.version) : '';
      audio = new Audio('/sounds/' + track.file + version);
      audio.preload = 'auto';
      audio.loop = !!track.loop;
      audio.volume = clamp01(baseVolume * track.volume);
      audio.addEventListener('error', () => { /* отсутствующий файл просто молчит */ });
      cache.set(name, audio);
    }
    return audio;
  }

  function applyVolume(audio, name) {
    const track = events[name];
    if (audio && track) audio.volume = clamp01(baseVolume * track.volume);
  }

  function applyAllVolumes() {
    for (const [name, audio] of cache) applyVolume(audio, name);
  }

  function stopLoops() {
    for (const [name, audio] of cache) {
      if (!events[name] || !events[name].loop) continue;
      audio.pause();
      try { audio.currentTime = 0; } catch (e) { /* ignore */ }
    }
  }

  function stopAll() {
    for (const audio of cache.values()) {
      audio.pause();
      try { audio.currentTime = 0; } catch (e) { /* ignore */ }
    }
  }

  // тихо отпускаем старые элементы, не вызывая лишних запросов к прежним URL
  function releaseAll() {
    for (const audio of cache.values()) {
      try { audio.pause(); } catch (e) { /* ignore */ }
    }
  }

  function play(name) {
    if (name === 'stop') { stopAll(); return; }
    if (!enabled || muted) return;
    const track = events[name];
    if (!track) return;
    if (!track.loop) stopLoops();       // любой обычный звук прекращает «тиканье» финала
    const audio = ensure(name);
    if (!audio) return;
    try { audio.currentTime = 0; } catch (e) { /* ещё не загрузился */ }
    audio.loop = !!track.loop;
    const p = audio.play();
    if (p && p.catch) {
      // Автозапуск заблокирован браузером: звук включится после первого клика
      // по странице (жеста пользователя). Отдельную подсказку не показываем.
      p.catch(() => {});
    }
  }

  function stopLoop(name) {
    const audio = cache.get(name || 'final');
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch (e) { /* ignore */ }
  }

  /** Заранее загружает звуки, чтобы первый вопрос не ждал сеть. */
  function warm() {
    if (!enabled || muted) return;
    for (const name of Object.keys(events)) ensure(name);
  }

  function configure(cfg) {
    if (!cfg) return;
    if (typeof cfg.enabled === 'boolean') enabled = cfg.enabled;
    if (cfg.volume != null && Number.isFinite(Number(cfg.volume))) baseVolume = clamp01(cfg.volume);
    if (cfg.events && typeof cfg.events === 'object') {
      const next = normalizeEvents(cfg.events);
      const sig = JSON.stringify(next);
      if (sig !== eventsSig) {
        releaseAll();
        cache.clear();
        events = next;
        eventsSig = sig;
      }
    }
    applyAllVolumes();
    if (!enabled) { stopAll(); } else warm();
    updateToggle();
  }

  function updateToggle() {
    if (!toggle) return;
    toggle.style.display = enabled ? '' : 'none';
    toggle.textContent = muted ? '🔇' : '🔊';
    toggle.title = muted ? 'Включить звук' : 'Выключить звук';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-pressed', String(muted));
  }

  function ensureUi() {
    if (toggle) return;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'sfxToggle';
    toggle.className = 'sfx-toggle';
    toggle.onclick = () => {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      if (muted) stopAll();
      else { warm(); play('correct'); }
      updateToggle();
    };
    document.body.appendChild(toggle);

    updateToggle();
    // Прогрев звуков запускается из configure(), когда придёт список файлов с версиями.
  }

  window.Sfx = { play, stopLoop, configure };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi);
  } else {
    ensureUi();
  }
})();
