const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const CONFIG_PATH = path.join(__dirname, 'game.config.json');

/**
 * Remove // and /* *\/ comments from JSON while respecting string literals,
 * so values like "http://..." or "C:\\path" are not corrupted.
 */
function stripJsonComments(str) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < str.length && str[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function deepMerge(base, extra) {
  if (extra === undefined) return base;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra;
  const result = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const [key, value] of Object.entries(extra)) result[key] = deepMerge(result[key], value);
  return result;
}

// Сценарий -> файл. Значения по умолчанию; game.config.json может переопределить.
const DEFAULT_SOUND_EVENTS = {
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

// Ставка в «Коте в мешке»: игрок озвучивает сумму, ведущий выбирает её в панели.
// Допустимы только два значения: min и max текущего раунда.
// min/max = null -> берутся минимальный и максимальный номинал текущего раунда из пака.
const DEFAULT_CAT_BET = {
  round1: { min: null, max: null, note: 'Игрок называет одну из двух ставок: {min} или {max}' },
  round2: { min: null, max: null, note: 'Игрок называет одну из двух ставок: {min} или {max}' },
  round3: { min: null, max: null, note: 'Игрок называет одну из двух ставок: {min} или {max}' }
};

function loadConfig() {
  const defaults = {
    port: 8102,
    questionsDir: 'questions',
    specials: {
      round1: { cats: { min: 1, max: 2 }, auctions: { min: 1, max: 2 } },
      round2: { cats: { min: 2, max: 2 }, auctions: { min: 2, max: 2 } },
      round3: { cats: { min: 2, max: 3 }, auctions: { min: 2, max: 3 } }
    },
    catBet: DEFAULT_CAT_BET,
    // Банк вопросов «Кота в мешке»: папка с JSON-файлами (см. QUESTIONS_FORMAT.md)
    catQuestions: {
      dir: 'questions/cats'
    },
    game: {
      allowPlayersReconnect: true,
      showSpecialMarkersToAdmin: true,
      showSpecialMarkersToTV: false,
      // По умолчанию вопрос остаётся на экране после верного ответа:
      // ведущий сам решает, когда закрыть его кнопкой «Закрыть вопрос».
      autoCloseQuestionOnCorrect: false
    },
    editor: {
      token: ''
    },
    images: {
      maxBytes: 8 * 1024 * 1024,
      maxWidth: 2560,
      maxHeight: 1440,
      quality: 82
    },
    sound: {
      enabled: true,
      volume: 0.8,
      events: DEFAULT_SOUND_EVENTS
    }
  };
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('game.config.json не найден — используются настройки по умолчанию.');
      return defaults;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return deepMerge(defaults, JSON.parse(stripJsonComments(raw)));
  } catch (e) {
    console.error('Не удалось прочитать game.config.json, используются настройки по умолчанию:', e.message);
    return defaults;
  }
}

const CONFIG = loadConfig();
const GAME = CONFIG.game || {};
const SOUND = CONFIG.sound || {};
const CAT_BET = CONFIG.catBet || {};
const EDITOR = CONFIG.editor || {};
const IMAGES = CONFIG.images || {};

const EDITOR_TOKEN = String(process.env.EDITOR_TOKEN || EDITOR.token || '').trim().normalize('NFC');
const IMAGE_MAX_BYTES = Math.max(
  1024 * 1024,
  Math.min(50 * 1024 * 1024, Number(IMAGES.maxBytes) || 8 * 1024 * 1024)
);
const IMAGE_MAX_WIDTH = Math.max(320, Math.min(8192, Number(IMAGES.maxWidth) || 2560));
const IMAGE_MAX_HEIGHT = Math.max(240, Math.min(8192, Number(IMAGES.maxHeight) || 1440));
const IMAGE_QUALITY = Math.max(40, Math.min(100, Number(IMAGES.quality) || 82));

function sanitizeSoundEvents(events) {
  const result = {};
  for (const [scenario, value] of Object.entries(events || {})) {
    if (!value || typeof value !== 'object') continue;
    // только имя файла внутри /sounds, без путей и протоколов
    const file = path.basename(String(value.file || '')).replace(/[^\w.\-]/g, '');
    if (!file) continue;
    const volume = Number(value.volume);
    result[scenario] = {
      file,
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
      ...(value.loop ? { loop: true } : {})
    };
  }
  return result;
}

/**
 * Версия звукового файла по времени изменения (mtime).
 * Добавляется к URL как ?v=..., чтобы браузер не играл старый файл из кеша
 * после замены mp3. Обновляется при каждом подключении клиента.
 */
function soundFileVersion(file) {
  try {
    return String(Math.floor(fs.statSync(path.join(__dirname, 'public', 'sounds', file)).mtimeMs));
  } catch (e) {
    return null;
  }
}

function soundEventsWithVersions() {
  const events = sanitizeSoundEvents({ ...DEFAULT_SOUND_EVENTS, ...(SOUND.events || {}) });
  for (const event of Object.values(events)) {
    const version = soundFileVersion(event.file);
    if (version) event.version = version;
  }
  return events;
}

function publicGameConfig() {
  const volume = Number(SOUND.volume);
  return {
    showSpecialMarkersToAdmin: GAME.showSpecialMarkersToAdmin !== false,
    showSpecialMarkersToTV: GAME.showSpecialMarkersToTV === true,
    allowPlayersReconnect: GAME.allowPlayersReconnect !== false,
    autoCloseQuestionOnCorrect: GAME.autoCloseQuestionOnCorrect !== false,
    sound: {
      enabled: SOUND.enabled !== false,
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8,
      events: soundEventsWithVersions()
    }
  };
}

/* ------------------------------------------------------------------ *
 * HTTP / Socket.IO
 * ------------------------------------------------------------------ */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || CONFIG.port || 8102;
const QUESTIONS_DIR = path.resolve(__dirname, CONFIG.questionsDir || 'questions');
// Банк вопросов для «Кота в мешке» (отдельная папка, не паки).
const CAT_QUESTIONS_DIR = path.resolve(__dirname, (CONFIG.catQuestions && CONFIG.catQuestions.dir) || path.join('questions', 'cats'));
const PUBLIC_DIR = path.join(__dirname, 'public');
// Картинки вопросов лежат рядом с паками и банком кота, в questions/images.
const IMAGES_ROOT = path.join(QUESTIONS_DIR, 'images');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);

try {
  fs.mkdirSync(IMAGES_ROOT, { recursive: true });
} catch (e) {
  console.warn('Не удалось создать папку картинок вопросов:', e.message);
}

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

// Картинки вопросов лежат в questions/images, но URL остаётся прежним:
// /images/questions/<пак>/<файл>.
app.use('/images/questions', express.static(IMAGES_ROOT, { setHeaders: setNoStore }));

// Остальные /images/... — UI-ассеты из public/images.
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images'), { setHeaders: setNoStore }));

// Sound files are large and rarely change: allow short caching instead of no-cache.
app.use('/sounds', express.static(path.join(__dirname, 'public', 'sounds'), {
  maxAge: '1h'
}));

// no-cache for static assets: avoids "stale page" after edits (use Ctrl+F5 less often)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

/**
 * Если mp3 в public/sounds заменили на диске, сразу рассылаем клиентам
 * новую конфигурацию звука: URL получит новый ?v=<mtime>, и ТВ-экран
 * подгрузит свежий файл, не дожидаясь перезапуска сервера.
 */
let soundReloadTimer = null;
try {
  fs.watch(path.join(__dirname, 'public', 'sounds'), () => {
    clearTimeout(soundReloadTimer);
    soundReloadTimer = setTimeout(() => {
      try { io.emit('game:config', publicGameConfig()); } catch (e) { /* ignore */ }
    }, 300);
  });
} catch (e) {
  console.warn('Не удалось следить за папкой public/sounds:', e.message);
}

app.get('/favicon.ico', (req, res) => res.status(204).end());

function lanAddresses() {
  const result = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address);
    }
  }
  return result;
}

function pickLanAddress() {
  const score = (ip) => (
    ip.startsWith('192.168.') ? 0
      : ip.startsWith('10.') ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  );
  return lanAddresses().sort((a, b) => score(a) - score(b))[0] || null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    game: 'svoy',
    uptime: Math.round(process.uptime()),
    rooms: rooms.size
  });
});

app.get('/api/net', (_req, res) => {
  res.json({
    ip: process.env.PUBLIC_HOST || pickLanAddress(),
    port: server.address()?.port || PORT,
    addresses: lanAddresses()
  });
});

app.get('/qr', async (req, res) => {
  try {
    const text = String(req.query.text || `${req.protocol}://${req.get('host')}/`).slice(0, 1000);
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      width: 512,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).send('QR error');
  }
});

/* ------------------------------------------------------------------ *
 * Question packs
 * ------------------------------------------------------------------ */

function listQuestionPacks() {
  if (!fs.existsSync(QUESTIONS_DIR)) return [];
  return fs.readdirSync(QUESTIONS_DIR)
    .filter((file) => file.toLowerCase().endsWith('.json'))
    .sort()
    .map((file) => ({ id: file, name: file }));
}

function resolvePublicImage(src) {
  const clean = String(src || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.split('/').includes('..')) return null;

  // Вопросные картинки: questions/images/<пак>/...
  if (clean.startsWith('images/questions/')) {
    const relative = clean.slice('images/questions/'.length);
    const full = path.resolve(IMAGES_ROOT, relative);
    const root = path.resolve(IMAGES_ROOT);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return full;
  }

  // Прочие /images/... (UI-ассеты) — из public/images.
  const full = path.resolve(PUBLIC_DIR, clean);
  const root = path.resolve(PUBLIC_DIR, 'images');
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Приводит картинку к виду { src, alt }. Поддерживает краткую запись строкой
 * и расширенную { src, alt }. Проверяет, что путь локальный и файл существует.
 */
function normalizeImageRef(value, label, fail, checkFile = true) {
  if (value == null) return null;

  let src = '';
  let alt = '';
  if (typeof value === 'string') {
    src = value.trim();
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    src = String(value.src || '').trim();
    alt = String(value.alt || '').trim().slice(0, 300);
  } else {
    fail(`${label}: ожидается строка или объект { src, alt }`);
  }

  if (!src) fail(`${label}: пустой путь к картинке`);
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || /^(?:data|file|javascript|blob):/i.test(src)) {
    fail(`${label}: внешние ссылки и data/file URL не поддерживаются`);
  }

  src = src.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!src.startsWith('images/')) fail(`${label}: путь должен начинаться с images/`);
  const parts = src.split('/');
  if (parts.includes('..') || parts.includes('.')) fail(`${label}: недопустимый путь`);

  const ext = path.extname(src).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    fail(`${label}: недопустимое расширение (${ext || 'без расширения'})`);
  }

  const full = resolvePublicImage(src);
  if (!full) fail(`${label}: путь выходит за пределы папки картинок`);

  if (checkFile) {
    if (!fs.existsSync(full)) fail(`${label}: файл не найден — ${src}`);
    const stat = fs.statSync(full);
    if (!stat.isFile()) fail(`${label}: это не файл — ${src}`);
    if (stat.size > IMAGE_MAX_BYTES) {
      fail(`${label}: файл больше ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)} МБ`);
    }
  }

  return { src: '/' + src, alt };
}

function normalizeQuestionImages(images, label, fail, checkFile = true) {
  if (images == null) return null;
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    fail(`${label}: поле images должно быть объектом { question, answer }`);
  }
  const question = normalizeImageRef(images.question, `${label}.question`, fail, checkFile);
  const answer = normalizeImageRef(images.answer, `${label}.answer`, fail, checkFile);
  const original = normalizeImageRef(images.original, `${label}.original`, fail, checkFile);
  if (!question && !answer) {
    fail(`${label}: нужна хотя бы одна картинка — question или answer`);
  }

  const result = {};
  if (question) result.question = question;
  if (answer) result.answer = answer;
  if (original) result.original = original;
  return result;
}

function validatePack(pack, filename) {
  const fail = (message) => { throw new Error(`Пак "${filename}": ${message}`); };
  if (!pack || typeof pack !== 'object') fail('ожидается JSON-объект');
  if (!pack.title) fail('нет поля "title"');

  for (const roundKey of ['round1', 'round2', 'round3']) {
    const round = pack[roundKey];
    if (!round || !Array.isArray(round.categories) || round.categories.length !== 6) {
      fail(`"${roundKey}" должен содержать 6 категорий`);
    }
    round.categories.forEach((category, ci) => {
      if (!category || typeof category.name !== 'string' || !category.name.trim()) {
        fail(`${roundKey}: у категории #${ci + 1} нет названия`);
      }
      if (!Array.isArray(category.questions) || category.questions.length !== 5) {
        fail(`${roundKey}: в категории «${category.name}» должно быть 5 вопросов`);
      }
      category.questions.forEach((question, qi) => {
        if (!question || question.value == null || question.text == null || question.answer == null) {
          fail(`${roundKey}: вопрос ${ci + 1}-${qi + 1} должен содержать value, text и answer`);
        }
        if (!Number.isFinite(Number(question.value))) {
          fail(`${roundKey}: вопрос ${ci + 1}-${qi + 1} — value должно быть числом`);
        }
        const normalizedImages = normalizeQuestionImages(
          question.images,
          `${roundKey}: вопрос ${ci + 1}-${qi + 1}`,
          fail,
          true
        );
        if (normalizedImages) question.images = normalizedImages;
        else delete question.images;
      });
    });
  }

  const final = pack.final;
  if (!final || typeof final !== 'object') {
    fail('нет блока "final"');
  }
  if (Array.isArray(final.themes)) {
    if (!final.themes.length) fail('в "final.themes" нет ни одной темы');
  } else if (final.theme && final.text && final.answer) {
    // старый формат: один финальный вопрос превращаем в список из одной темы
    final.themes = [{
      theme: final.theme,
      text: final.text,
      answer: final.answer,
      images: final.images
    }];
  } else {
    fail('нет корректного блока "final" (нужен массив themes или theme/text/answer)');
  }

  final.themes.forEach((theme, index) => {
    if (!theme || !theme.theme || !theme.text || !theme.answer) {
      fail(`финальная тема #${index + 1} должна содержать theme, text и answer`);
    }
    const normalizedImages = normalizeQuestionImages(
      theme.images,
      `финальная тема #${index + 1}`,
      fail,
      true
    );
    if (normalizedImages) theme.images = normalizedImages;
    else delete theme.images;
  });

  return pack;
}

function loadPack(filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe.toLowerCase().endsWith('.json')) throw new Error('Некорректное имя файла пака');
  const full = path.join(QUESTIONS_DIR, safe);
  if (!full.startsWith(QUESTIONS_DIR)) throw new Error('Некорректный путь к паку');
  const raw = fs.readFileSync(full, 'utf-8');
  return validatePack(JSON.parse(raw), safe);
}

/* ------------------------------------------------------------------ *
 * Банк вопросов «Кота в мешке»
 *
 * Отдельная папка (по умолчанию questions/cats). Каждый JSON-файл:
 *   [{ "theme": "...", "text": "...", "answer": "...", "played": false }]
 * или { "title": "...", "questions": [ ... ] }.
 *
 * Когда вопрос выпадает коту, сервер ставит played=true и сразу сохраняет
 * файл, поэтому счётчик сыгранных вопросов переживает перезапуск.
 * ------------------------------------------------------------------ */

function listCatBankFiles() {
  try {
    if (!fs.existsSync(CAT_QUESTIONS_DIR)) return [];
    return fs.readdirSync(CAT_QUESTIONS_DIR)
      .filter((file) => file.toLowerCase().endsWith('.json'))
      .sort();
  } catch (e) {
    console.error('Не удалось прочитать папку банка «Кота в мешке»:', e.message);
    return [];
  }
}

// Читает файл банка целиком; поддерживает массив и объект с полем questions.
function readCatBankFile(file) {
  const full = path.join(CAT_QUESTIONS_DIR, file);
  const raw = fs.readFileSync(full, 'utf-8');
  const data = JSON.parse(stripJsonComments(raw));
  const isArray = Array.isArray(data);
  const list = isArray ? data : (data && Array.isArray(data.questions) ? data.questions : null);
  if (!list) throw new Error('ожидается массив вопросов или поле "questions"');
  return { full, file, data, isArray, list };
}

// Сохраняет файл в том же виде, в котором он был (массив или объект).
function writeCatBankFile(bank) {
  const out = bank.isArray ? bank.list : { ...bank.data, questions: bank.list };
  fs.writeFileSync(bank.full, JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

function isCatBankQuestion(question) {
  return !!question && typeof question === 'object'
    && typeof question.text === 'string' && question.text.trim() !== ''
    && typeof question.answer === 'string' && question.answer.trim() !== '';
}

/**
 * Сводка для админ-панели: сколько всего вопросов в банке, сколько сыграно
 * и сколько осталось. Ничего не меняет на диске.
 */
function catBankState() {
  const files = listCatBankFiles();
  let total = 0;
  let played = 0;
  let broken = 0;
  const details = [];

  for (const file of files) {
    try {
      const bank = readCatBankFile(file);
      const valid = bank.list.filter(isCatBankQuestion);
      const used = valid.filter((question) => question.played === true).length;
      total += valid.length;
      played += used;
      details.push({ file, total: valid.length, played: used, remaining: valid.length - used });
    } catch (e) {
      broken++;
      details.push({ file, error: e.message });
    }
  }

  return {
    dir: path.relative(__dirname, CAT_QUESTIONS_DIR).replace(/\\/g, '/') || CAT_QUESTIONS_DIR,
    files: details,
    total,
    played,
    remaining: Math.max(0, total - played),
    broken
  };
}

/**
 * Берёт случайный несыгранный вопрос из банка, помечает его сыгранным
 * и сохраняет файл. Возвращает null, если вопросов не осталось.
 */
function pickCatQuestion() {
  const candidates = [];

  for (const file of listCatBankFiles()) {
    let bank;
    try {
      bank = readCatBankFile(file);
    } catch (e) {
      continue;
    }
    bank.list.forEach((question, index) => {
      if (!isCatBankQuestion(question) || question.played === true) return;
      let images = null;
      try {
        images = normalizeQuestionImages(
          question.images,
          `Вопрос банка «${file}» #${index + 1}`,
          (message) => { throw new Error(message); },
          true
        );
      } catch (e) {
        console.warn(`Пропущен вопрос банка «Кота в мешке»: ${e.message}`);
        return;
      }
      candidates.push({ bank, index, question, images });
    });
  }

  if (!candidates.length) return null;

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  try {
    picked.bank.list[picked.index].played = true;
    writeCatBankFile(picked.bank);
  } catch (e) {
    console.error('Не удалось сохранить статус вопроса «Кота в мешке»:', e.message);
  }

  const source = picked.question;
  return {
    theme: typeof source.theme === 'string' && source.theme.trim() ? source.theme.trim() : 'Без темы',
    text: source.text,
    answer: source.answer,
    images: picked.images || null
  };
}

/** Возвращает всем вопросам банка статус «не сыгран». */
function resetCatBank() {
  let changed = 0;

  for (const file of listCatBankFiles()) {
    let bank;
    try {
      bank = readCatBankFile(file);
    } catch (e) {
      continue;
    }
    let touched = false;
    bank.list.forEach((question) => {
      if (isCatBankQuestion(question) && question.played === true) {
        question.played = false;
        touched = true;
        changed++;
      }
    });
    if (touched) {
      try {
        writeCatBankFile(bank);
      } catch (e) {
        console.error(`Не удалось сбросить статусы в ${file}:`, e.message);
      }
    }
  }

  return { changed, state: catBankState() };
}

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

const rooms = new Map();
let lastRoomsSig = '';

function publicRooms() {
  return Array.from(rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    players: room.players.size,
    phase: room.phase,
    packTitle: room.pack ? room.pack.title : null
  }));
}

function emitRoomsList(force = false) {
  const list = publicRooms();
  const sig = JSON.stringify(list);
  if (!force && sig === lastRoomsSig) return;
  lastRoomsSig = sig;
  io.emit('rooms:list', list);
}

function publicPlayers(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected
  }));
}

function randInt(min, max) {
  const a = Number.isFinite(min) ? Math.floor(min) : 0;
  const b = Number.isFinite(max) ? Math.floor(max) : a;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function getSpecialCount(cfg) {
  if (typeof cfg === 'number') return Math.max(0, Math.floor(cfg));
  if (cfg && typeof cfg === 'object') return Math.max(0, randInt(cfg.min ?? 0, cfg.max ?? cfg.min ?? 0));
  return 0;
}

function assignSpecials(room) {
  const specials = {};
  const sc = CONFIG.specials || {};

  const pick = (phase) => {
    const phaseCfg = sc[phase] || {};
    const catCount = getSpecialCount(phaseCfg.cats);
    const auctionCount = getSpecialCount(phaseCfg.auctions);
    const keys = [];
    for (let ci = 0; ci < 6; ci++) {
      for (let qi = 0; qi < 5; qi++) keys.push(`${phase}:${ci}:${qi}`);
    }
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    let idx = 0;
    for (let n = 0; n < catCount && idx < keys.length; n++, idx++) specials[keys[idx]] = 'cat';
    for (let n = 0; n < auctionCount && idx < keys.length; n++, idx++) specials[keys[idx]] = 'auction';
  };

  if (room.pack && room.pack.round1) pick('round1');
  if (room.pack && room.pack.round2) pick('round2');
  if (room.pack && room.pack.round3) pick('round3');
  room.specials = specials;
}

function getQuestionType(room, phase, ci, qi) {
  return (room.specials && room.specials[`${phase}:${ci}:${qi}`]) || 'normal';
}

function isRoundDone(room, phase, round) {
  return round.categories.every((category, ci) =>
    category.questions.every((question, qi) => !!room.used[`${phase}:${ci}:${qi}`])
  );
}

function updatePhaseAfterRound(room) {
  for (const n of [1, 2, 3]) {
    const key = `round${n}`;
    if (room.phase === key && room.pack && room.pack[key] && isRoundDone(room, key, room.pack[key])) {
      room.phase = `${key}_done`;
    }
  }
}

/* ---- Финал: темы, которые админ убирает по одной ---- */

function finalThemes(room) {
  const final = room.pack && room.pack.final;
  return final && Array.isArray(final.themes) ? final.themes : [];
}

function remainingFinalIndexes(room) {
  const removed = room.finalRemoved || new Set();
  return finalThemes(room).map((_, index) => index).filter((index) => !removed.has(index));
}

function resetFinalState(room) {
  room.finalRemoved = new Set();
  room.finalBets = new Map();
  room.finalAnswers = new Map();
  room.finalResults = new Map();
}

function closeCurrentQuestion(room) {
  if (!room.current) return;
  if (room.current.key) room.used[room.current.key] = true;
  room.selected = null;
  room.hovered = null;
  room.current = null;
  room.boardVisible = false;
  room.buzz = null;
  updatePhaseAfterRound(room);
}

/**
 * Strip everything the viewer must not see yet.
 * Answers, cat themes and special markers never leak to TV/phones.
 */
function sanitizeCurrent(current, isAdmin) {
  const copy = { ...current };
  if (!copy.question) return copy;

  copy.question = { ...copy.question };
  if (copy.question.images) {
    copy.question.images = { ...copy.question.images };
    // Оригинал — это чистая картинка-ответ, клиентам игры он не нужен.
    delete copy.question.images.original;
  }

  if (!isAdmin) {
    // Ответ и его картинка — только после «Показать ответ».
    if (!copy.answerVisible) {
      delete copy.question.answer;
      if (copy.question.images) delete copy.question.images.answer;
    }

    // Текст и картинка-загадка для кота/аукциона — только после показа вопроса.
    if (copy.revealed === false) {
      delete copy.question.text;
      if (copy.question.images) delete copy.question.images.question;
    }

    // Тема кота до передачи игроку не раскрывается.
    if (copy.stage === 'cat_reveal' && copy.question.type === 'cat') {
      delete copy.question.theme;
    }
  }

  if (copy.question.images && !copy.question.images.question && !copy.question.images.answer) {
    delete copy.question.images;
  }

  return copy;
}

/* ---- «Кот в мешке»: диапазон ставки ---- */

function roundPhaseKey(phase) {
  return phase === 'round1' || phase === 'round2' || phase === 'round3' ? phase : null;
}

/**
 * Две допустимые ставки для «Кота в мешке» в текущем раунде.
 *
 * Ставка может быть только минимумом или максимумом раунда.
 * По умолчанию min/max — это минимальный и максимальный номинал вопросов
 * текущего раунда (round1: 100…500, round2: 200…1000, round3: 300…1500).
 * В game.config.json (catBet.roundN) можно задать свои min/max и текст
 * note — он показывается на ТВ и телефонах, {min}/{max} подставляются.
 */
function catBetLimits(room) {
  const key = roundPhaseKey(room.phase);
  const round = key && room.pack ? room.pack[key] : null;
  if (!round || !Array.isArray(round.categories)) return null;

  let packMin = Infinity;
  let packMax = -Infinity;
  for (const category of round.categories) {
    for (const question of category.questions || []) {
      const value = Number(question.value);
      if (!Number.isFinite(value)) continue;
      if (value < packMin) packMin = value;
      if (value > packMax) packMax = value;
    }
  }
  if (!Number.isFinite(packMin) || !Number.isFinite(packMax)) return null;

  const cfg = CAT_BET[key] || {};
  const cfgMin = cfg.min == null ? NaN : Number(cfg.min);
  const cfgMax = cfg.max == null ? NaN : Number(cfg.max);
  const min = Math.max(1, Math.round(Number.isFinite(cfgMin) ? cfgMin : packMin));
  const max = Math.max(min, Math.round(Number.isFinite(cfgMax) ? cfgMax : packMax));
  const note = String(cfg.note == null ? '' : cfg.note)
    .replace(/\{min\}/g, String(min))
    .replace(/\{max\}/g, String(max));
  return { min, max, note };
}

function boardState(room, options = {}) {
  if (!room.pack) return null;
  const isAdmin = !!options.admin;
  const viewerId = options.playerId || null;
  const exposeSpecialMarkers = isAdmin
    ? GAME.showSpecialMarkersToAdmin !== false
    : GAME.showSpecialMarkersToTV === true;

  const makeRound = (round, phase) => ({
    name: round.name,
    categories: round.categories.map((category, ci) => ({
      name: category.name,
      questions: category.questions.map((question, qi) => ({
        value: question.value,
        ...(exposeSpecialMarkers ? { type: getQuestionType(room, phase, ci, qi) } : {}),
        used: room.used[`${phase}:${ci}:${qi}`] || false,
        ci,
        qi
      }))
    }))
  });

  const current = room.current ? sanitizeCurrent(room.current, isAdmin) : null;
  if (current && current.question && current.question.type === 'cat' && current.catBet) {
    // ставка не секрет: игрок озвучивает её вслух
    current.catBet = {
      min: current.catBet.min,
      max: current.catBet.max,
      note: current.catBet.note || '',
      stake: current.catBet.stake == null ? null : current.catBet.stake
    };
  }
  const round = room.phase === 'round1'
    ? makeRound(room.pack.round1, 'round1')
    : room.phase === 'round2'
      ? makeRound(room.pack.round2, 'round2')
      : room.phase === 'round3'
        ? makeRound(room.pack.round3, 'round3')
        : null;

  let final = null;
  if (room.phase === 'final' || room.phase === 'final_show') {
    const themes = finalThemes(room);
    const removed = room.finalRemoved || new Set();
    const remaining = remainingFinalIndexes(room);
    const selectedIndex = remaining.length === 1 ? remaining[0] : null;
    const source = selectedIndex != null ? themes[selectedIndex] : null;
    final = {
      // public list: names only, never questions/answers
      themes: themes.map((theme, index) => ({
        theme: theme.theme,
        removed: removed.has(index),
        selected: index === selectedIndex
      })),
      remaining: remaining.length,
      selectedIndex,
      theme: source ? source.theme : null,
      text: source && room.current && room.current.finalRevealed ? source.text : null,
      revealed: !!(room.current && room.current.finalRevealed),
      answerVisible: !!(room.current && room.current.finalAnswerVisible),
      images: {
        question: source && (isAdmin || (room.current && room.current.finalRevealed))
          ? (source.images && source.images.question) || null
          : null,
        answer: source && (isAdmin || (room.current && room.current.finalAnswerVisible))
          ? (source.images && source.images.answer) || null
          : null
      },
      bets: {},
      answers: {}
    };
    if (isAdmin) {
      final.answer = source ? source.answer : null;
      final.bets = Object.fromEntries(room.finalBets);
      final.answers = Object.fromEntries(room.finalAnswers);
      final.results = Object.fromEntries(room.finalResults);
    } else if (source && room.current && room.current.finalAnswerVisible) {
      final.answer = source.answer;
      if (viewerId && room.finalBets.has(viewerId)) {
        final.bets = { [viewerId]: room.finalBets.get(viewerId) };
      }
    } else if (viewerId && room.finalBets.has(viewerId)) {
      // a player only sees their own bet
      final.bets = { [viewerId]: room.finalBets.get(viewerId) };
    }
  }

  return {
    view: isAdmin ? 'admin' : viewerId ? 'player' : 'public',
    phase: room.phase,
    round,
    selected: room.selected,
    hovered: room.hovered,
    boardVisible: !!room.boardVisible,
    current,
    buzz: room.buzz
      ? {
          winnerId: room.buzz.winnerId,
          winnerName: room.buzz.winnerName,
          open: room.buzz.open,
          locked: Array.from(room.buzz.locked)
        }
      : null,
    final
  };
}

function emitBoard(room) {
  // 1. public view for TV and phones. The admin socket gets only the richer
  //    admin view: sending it both views made the board flicker/rebuild twice.
  const publicTarget = room.adminId ? io.to(room.id).except(room.adminId) : io.to(room.id);
  publicTarget.emit('board:state', boardState(room));
  // 2. admin view (always sees answers and special types)
  if (room.adminId) io.to(room.adminId).emit('board:state', boardState(room, { admin: true }));
  // 3. personal view for players (only to expose their own final bet)
  if (room.phase === 'final' || room.phase === 'final_show') {
    for (const player of room.players.values()) {
      if (player.connected && player.socketId) {
        io.to(player.socketId).emit('board:state', boardState(room, { playerId: player.id }));
      }
    }
  }
}

/**
 * Hover is purely visual: send a tiny dedicated event instead of the full
 * room/board state, otherwise every mouse move rebuilds the board and breaks
 * real mouse clicks (mousedown and mouseup land on different DOM nodes).
 */
function emitHover(room) {
  io.to(room.id).emit('board:hover', { hovered: room.hovered || null });
}

/** Игровой звук — только на экранах ТВ (у админа и игроков звука нет). */
function emitSfx(room, name) {
  if (!room || !name) return;
  for (const socketId of room.displayIds || []) {
    io.to(socketId).emit('sfx', { name });
  }
}

function broadcastRoom(room) {
  room.lastActivity = Date.now();
  io.to(room.id).emit('room:state', {
    id: room.id,
    name: room.name,
    phase: room.phase,
    players: publicPlayers(room),
    packTitle: room.pack ? room.pack.title : null
  });
  emitBoard(room);
  emitRoomsList();
}

/* ------------------------------------------------------------------ *
 * Socket handlers
 * ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  socket.emit('rooms:list', publicRooms());
  socket.emit('packs:list', listQuestionPacks());
  socket.emit('game:config', publicGameConfig());

  socket.on('admin:createRoom', ({ name } = {}, cb) => {
    try {
      const id = nanoid(6).toUpperCase();
      const adminToken = nanoid(12);
      const now = Date.now();
      const room = {
        id,
        name: String(name || '').trim().slice(0, 60) || `Игра ${id}`,
        createdAt: now,
        lastActivity: now,
        adminId: null,
        adminToken,
        displayIds: new Set(),
        players: new Map(),
        pack: null,
        packFile: null,
        phase: 'lobby',
        used: {},
        specials: {},
        selected: null,
        hovered: null,
        current: null,
        boardVisible: false,
        buzz: null,
        finalBets: new Map(),
        finalAnswers: new Map(),
        finalResults: new Map(),
        finalRemoved: new Set()
      };
      rooms.set(id, room);
      cb && cb({ ok: true, roomId: id, adminToken });
      broadcastRoom(room);
    } catch (e) {
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('display:join', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'Комната не найдена' });
    room.displayIds.add(socket.id);
    socket.join(roomId);
    socket.data.role = 'display';
    socket.data.roomId = roomId;
    cb && cb({ ok: true });
    socket.emit('room:state', {
      id: room.id,
      name: room.name,
      phase: room.phase,
      players: publicPlayers(room),
      packTitle: room.pack ? room.pack.title : null
    });
    socket.emit('board:state', boardState(room));
  });

  socket.on('admin:join', ({ roomId, adminToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'Комната не найдена' });

    const tokenOk = !!adminToken && !!room.adminToken && adminToken === room.adminToken;
    const sameSocket = room.adminId === socket.id;
    if (!tokenOk && !sameSocket) {
      const busy = room.adminId && room.adminId !== socket.id;
      return cb && cb({ ok: false, error: busy ? 'Администратор уже подключён' : 'Нет прав администратора (нет токена)' });
    }

    room.adminId = socket.id;
    socket.join(roomId);
    socket.data.role = 'admin';
    socket.data.roomId = roomId;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('player:join', ({ roomId, name, playerId, playerToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'Комната не найдена' });
    if (room.phase === 'finished') return cb && cb({ ok: false, error: 'Игра уже завершена' });

    const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const canReconnect = GAME.allowPlayersReconnect !== false;
    const existing = canReconnect && playerId ? room.players.get(playerId) : null;
    const isOwner = !!(existing && playerToken && existing.token === playerToken);
    let player;

    if (isOwner) {
      player = existing;
      player.connected = true;
      player.socketId = socket.id;
      if (cleanName) player.name = cleanName;
    } else {
      if (!cleanName) return cb && cb({ ok: false, error: 'Введите ник, чтобы войти в игру' });
      player = { id: nanoid(8), token: nanoid(16), name: cleanName, score: 0, connected: true, socketId: socket.id };
      room.players.set(player.id, player);
    }

    socket.join(roomId);
    socket.data.role = 'player';
    socket.data.roomId = roomId;
    socket.data.playerId = player.id;
    cb && cb({ ok: true, playerId: player.id, playerToken: player.token });
    broadcastRoom(room);
  });

  socket.on('admin:listPacks', (cb) => cb && cb({ ok: true, packs: listQuestionPacks() }));

  socket.on('admin:getState', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false, error: 'Нет доступа' });
    cb && cb({
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        phase: room.phase,
        players: publicPlayers(room),
        packTitle: room.pack ? room.pack.title : null
      },
      board: boardState(room, { admin: true }),
      packs: listQuestionPacks(),
      config: publicGameConfig(),
      catBank: catBankState()
    });
  });

  socket.on('admin:selectPack', ({ roomId, filename } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false, error: 'Нет доступа' });
    try {
      room.pack = loadPack(filename);
      room.packFile = path.basename(filename);
      room.used = {};
      room.selected = null;
      room.hovered = null;
      room.current = null;
      room.boardVisible = false;
      room.buzz = null;
      room.phase = 'lobby';
      resetFinalState(room);
      assignSpecials(room);
      for (const player of room.players.values()) player.score = 0;
      cb && cb({ ok: true, title: room.pack.title });
      emitSfx(room, 'stop');
      broadcastRoom(room);
    } catch (e) {
      cb && cb({ ok: false, error: 'Ошибка загрузки пака: ' + e.message });
    }
  });

  socket.on('admin:startRound', ({ roomId, round } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.pack) return cb && cb({ ok: false, error: 'Нет доступа' });
    if (round !== 1 && round !== 2 && round !== 3 && round !== 'final') {
      return cb && cb({ ok: false, error: 'Неизвестный раунд' });
    }

    room.phase = round === 'final' ? 'final' : `round${round}`;
    room.selected = null;
    room.hovered = null;
    room.current = null;
    room.boardVisible = false;
    room.buzz = null;
    if (round === 'final') resetFinalState(room);
    cb && cb({ ok: true });
    emitSfx(room, round === 'final' ? 'final' : 'roundStart');
    broadcastRoom(room);
  });

  socket.on('admin:hoverQuestion', ({ roomId, ci, qi } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    const next = (ci == null || qi == null) ? null : { ci: Number(ci), qi: Number(qi) };
    const prev = room.hovered;
    const same = (!next && !prev) || (next && prev && next.ci === prev.ci && next.qi === prev.qi);
    room.hovered = next;
    cb && cb({ ok: true });
    if (!same) emitHover(room);
  });

  socket.on('admin:showQuestion', ({ roomId, ci, qi } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.pack) return cb && cb({ ok: false, error: 'Нет доступа' });
    if (room.current) return cb && cb({ ok: false, error: 'Сначала завершите текущий вопрос' });
    if (room.phase !== 'round1' && room.phase !== 'round2' && room.phase !== 'round3') {
      return cb && cb({ ok: false, error: 'Сначала запустите раунд' });
    }

    const ciNum = Number(ci);
    const qiNum = Number(qi);
    if (!Number.isInteger(ciNum) || !Number.isInteger(qiNum) || ciNum < 0 || ciNum > 5 || qiNum < 0 || qiNum > 4) {
      return cb && cb({ ok: false, error: 'Некорректный вопрос' });
    }

    const round = room.phase === 'round1'
      ? room.pack.round1
      : room.phase === 'round2'
        ? room.pack.round2
        : room.pack.round3;
    const category = round.categories[ciNum];
    const baseQuestion = category && category.questions[qiNum];
    if (!baseQuestion) return cb && cb({ ok: false, error: 'Вопрос не найден' });

    const key = `${room.phase}:${ciNum}:${qiNum}`;
    if (room.used[key]) return cb && cb({ ok: false, error: 'Уже сыграно' });

    const qType = getQuestionType(room, room.phase, ciNum, qiNum);
    let question = { ...baseQuestion, type: qType };
    if (qType === 'cat') {
      // Вопрос кота берём из отдельного банка: тема, текст и ответ другие,
      // а номинал (и ставки) остаются от клетки на табло.
      const donor = pickCatQuestion();
      if (!donor) {
        return cb && cb({ ok: false, error: 'В банке «Кота в мешке» нет несыгранных вопросов. Добавьте вопросы или сбросьте статусы в панели.' });
      }
      question = {
        value: baseQuestion.value,
        cost: baseQuestion.value,
        text: donor.text,
        answer: donor.answer,
        theme: donor.theme,
        images: donor.images || null,
        type: 'cat'
      };
    }

    room.selected = { ci: ciNum, qi: qiNum };
    room.hovered = null;
    room.boardVisible = false;
    room.current = {
      ci: ciNum,
      qi: qiNum,
      key,
      question,
      stage: qType === 'cat' ? 'cat_reveal' : qType === 'auction' ? 'auction' : 'open',
      revealed: qType === 'normal',
      answerVisible: false
    };
    if (qType === 'cat') {
      // диапазон возможной ставки фиксируем на момент открытия кота
      const limits = catBetLimits(room);
      if (limits) room.current.catBet = { ...limits, stake: null };
    }
    room.buzz = { open: qType === 'normal', winnerId: null, winnerName: null, locked: new Set() };
    cb && cb({ ok: true });
    emitSfx(room, qType === 'cat' ? 'cat' : qType === 'auction' ? 'auction' : 'questionOpen');
    broadcastRoom(room);
    if (qType === 'cat') socket.emit('catbank:state', catBankState());
  });

  socket.on('admin:revealQuestion', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    const currentQuestion = room.current.question;
    if (currentQuestion && currentQuestion.type === 'cat') {
      if (!room.current.catBet || room.current.catBet.stake == null) {
        return cb && cb({ ok: false, error: 'Сначала выберите ставку игрока' });
      }
    }
    room.current.revealed = true;
    cb && cb({ ok: true });
    emitSfx(room, 'questionOpen');
    broadcastRoom(room);
  });

  socket.on('admin:revealAnswer', ({ roomId, show } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    room.current.answerVisible = !!show;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:setBoardVisible', ({ roomId, visible } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    room.boardVisible = !!visible;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:buzzControl', ({ roomId, action } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (!room.buzz) room.buzz = { open: false, winnerId: null, winnerName: null, locked: new Set() };
    if (action === 'open') {
      room.buzz.open = true;
      room.buzz.winnerId = null;
      room.buzz.winnerName = null;
      room.buzz.locked = new Set();
    }
    if (action === 'reset') {
      room.buzz.winnerId = null;
      room.buzz.winnerName = null;
    }
    if (action === 'close') room.buzz.open = false;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('player:buzz', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.role !== 'player') return cb && cb({ ok: false });
    const playerId = socket.data.playerId;
    const player = room.players.get(playerId);
    if (!player) return cb && cb({ ok: false });
    if (!room.current || !room.buzz || !room.buzz.open) return cb && cb({ ok: false });
    if (room.buzz.winnerId) return cb && cb({ ok: false });
    if (room.buzz.locked.has(playerId)) return cb && cb({ ok: false });
    room.buzz.winnerId = playerId;
    room.buzz.winnerName = player.name;
    room.buzz.open = false;
    cb && cb({ ok: true });
    emitSfx(room, 'buzz');
    broadcastRoom(room);
  });

  socket.on('admin:judge', ({ roomId, correct, playerId, delta } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    if (room.current.resolved) return cb && cb({ ok: false, error: 'Вопрос уже завершён' });

    const question = room.current.question;
    const pid = playerId || (room.buzz && room.buzz.winnerId);
    const player = room.players.get(pid);
    if (!player) return cb && cb({ ok: false, error: 'Игрок не найден' });

    let amount = typeof delta === 'number' && !Number.isNaN(delta) ? delta : (question.cost || question.value || 0);
    if (room.current.auction && room.current.auction.stake != null) amount = room.current.auction.stake;
    if (question.type === 'cat' && room.current.catBet && room.current.catBet.stake != null) {
      amount = room.current.catBet.stake;
    }

    const singleResponder = !!(room.current.auction || room.current.catTargetId ||
      question.type === 'auction' || question.type === 'cat');

    if (correct) {
      player.score += amount;
      room.current.resolved = true;
      room.current.answerVisible = true;
      if (GAME.autoCloseQuestionOnCorrect !== false) {
        closeCurrentQuestion(room);
      } else if (room.buzz) {
        room.buzz.open = false;
        room.buzz.winnerId = pid;
        room.buzz.winnerName = player.name;
      }
    } else {
      player.score -= amount;
      if (singleResponder) {
        closeCurrentQuestion(room);
      } else if (room.buzz) {
        room.buzz.locked.add(pid);
        room.buzz.winnerId = null;
        room.buzz.winnerName = null;
        room.buzz.open = true;
      }
    }
    cb && cb({ ok: true });
    emitSfx(room, correct ? 'correct' : 'wrong');
    broadcastRoom(room);
  });

  socket.on('admin:closeQuestion', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current || !room.current.key) return cb && cb({ ok: false });
    closeCurrentQuestion(room);
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:setCatTarget', ({ roomId, playerId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    const player = room.players.get(playerId);
    if (!player) return cb && cb({ ok: false, error: 'Игрок не найден' });

    room.current.catTargetId = player.id;
    // Сначала объявляем тему (стадия cat_theme), ставку спрашиваем отдельным шагом.
    room.current.stage = 'cat_theme';
    // new responder announces a new stake
    if (!room.current.catBet) {
      const limits = catBetLimits(room);
      if (limits) room.current.catBet = { ...limits, stake: null };
    } else {
      room.current.catBet.stake = null;
    }
    // question stays hidden until the admin explicitly reveals it
    room.buzz = { open: false, winnerId: player.id, winnerName: player.name, locked: new Set() };
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  // Переход «тема объявлена → спрашиваем ставку»: на ТВ появляются два числа.
  socket.on('admin:catAskStake', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    const question = room.current.question;
    if (!question || question.type !== 'cat') return cb && cb({ ok: false, error: 'Сейчас не «Кот в мешке»' });
    if (!room.current.catTargetId) return cb && cb({ ok: false, error: 'Сначала передайте кота игроку' });
    if (room.current.revealed) return cb && cb({ ok: false, error: 'Вопрос уже показан — ставку менять нельзя' });

    const limits = room.current.catBet || catBetLimits(room);
    if (!limits) return cb && cb({ ok: false, error: 'Не удалось определить ставку' });
    if (!room.current.catBet) room.current.catBet = { ...limits, stake: null };
    room.current.catBet.stake = null;
    room.current.stage = 'cat_bet';
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:setCatStake', ({ roomId, stake, choice } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    const question = room.current.question;
    if (!question || question.type !== 'cat') return cb && cb({ ok: false, error: 'Сейчас не «Кот в мешке»' });
    if (!room.current.catTargetId) return cb && cb({ ok: false, error: 'Сначала передайте кота игроку' });
    if (room.current.stage === 'cat_theme') return cb && cb({ ok: false, error: 'Сначала спросите ставку у игрока' });
    if (room.current.revealed) return cb && cb({ ok: false, error: 'Вопрос уже показан — ставку менять нельзя' });

    const limits = room.current.catBet || catBetLimits(room);
    if (!limits) return cb && cb({ ok: false, error: 'Не удалось определить ставку' });

    // Ставка в «Коте в мешке» — только минимум или максимум раунда
    // (в панели админа это две кнопки, на ТВ — два числа).
    let picked = null;
    if (choice === 'min') picked = limits.min;
    else if (choice === 'max') picked = limits.max;
    else {
      const parsed = Math.round(Number(stake));
      if (!Number.isFinite(parsed)) return cb && cb({ ok: false, error: 'Выберите одну из двух ставок' });
      if (parsed !== limits.min && parsed !== limits.max) {
        const allowed = limits.min === limits.max ? String(limits.min) : `${limits.min} или ${limits.max}`;
        return cb && cb({ ok: false, error: `Ставка может быть только ${allowed}` });
      }
      picked = parsed;
    }

    room.current.catBet = { ...limits, stake: picked };
    cb && cb({ ok: true, stake: picked });
    broadcastRoom(room);
  });

  socket.on('admin:setAuction', ({ roomId, playerId, stake } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id || !room.current) return cb && cb({ ok: false });
    const player = room.players.get(playerId);
    if (!player) return cb && cb({ ok: false, error: 'Игрок не найден' });

    const parsedStake = Number(stake);
    const cap = Math.max(0, Number(player.score) || 0);
    const nominal = Math.max(0, Number(room.current.question.value) || 0);
    const minStake = Math.min(nominal, cap);
    const safeStake = Number.isFinite(parsedStake)
      ? Math.max(minStake, Math.min(cap, parsedStake))
      : minStake;
    room.current.auction = { playerId: player.id, stake: safeStake };
    room.current.stage = 'open';
    room.buzz = { open: false, winnerId: player.id, winnerName: player.name, locked: new Set() };
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:setScore', ({ roomId, playerId, score } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    const player = room.players.get(playerId);
    if (player) player.score = Number(score) || 0;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('player:finalBet', ({ roomId, bet } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал недоступен' });
    if (remainingFinalIndexes(room).length !== 1) {
      return cb && cb({ ok: false, error: 'Сначала ведущий должен оставить одну тему' });
    }
    if (room.current && room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Нельзя менять ставку после показа вопроса' });
    }
    const playerId = socket.data.playerId;
    const player = room.players.get(playerId);
    if (!player || player.score <= 0) return cb && cb({ ok: false, error: 'Вы не участвуете в финале' });
    const value = Math.max(1, Math.min(player.score, Number(bet) || 1));
    room.finalBets.set(playerId, value);
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('player:finalAnswer', ({ roomId, answer } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'final') return cb && cb({ ok: false });
    if (!room.current || !room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Вопрос ещё не показан' });
    }
    const playerId = socket.data.playerId;
    if (!playerId || !room.players.has(playerId)) return cb && cb({ ok: false });
    room.finalAnswers.set(playerId, String(answer || '').slice(0, 500));
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:removeFinalTheme', ({ roomId, index } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал не запущен' });
    if (room.current && room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Вопрос уже показан — менять темы нельзя' });
    }
    const themes = finalThemes(room);
    const remaining = remainingFinalIndexes(room);
    if (remaining.length <= 1) return cb && cb({ ok: false, error: 'Осталась одна тема' });
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= themes.length || room.finalRemoved.has(idx)) {
      return cb && cb({ ok: false, error: 'Некорректная тема' });
    }
    room.finalRemoved.add(idx);
    // ставки принимаются только после выбора темы
    room.finalBets = new Map();
    room.finalAnswers = new Map();
    room.finalResults = new Map();
    cb && cb({ ok: true, remaining: remaining.length - 1 });
    broadcastRoom(room);
  });

  socket.on('admin:resetFinalThemes', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал не запущен' });
    if (room.current && room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Вопрос уже показан — менять темы нельзя' });
    }
    room.finalRemoved = new Set();
    room.finalBets = new Map();
    room.finalAnswers = new Map();
    room.finalResults = new Map();
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:finalReveal', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал не запущен' });
    if (remainingFinalIndexes(room).length !== 1) {
      return cb && cb({ ok: false, error: 'Сначала оставьте одну тему' });
    }
    room.current = { finalRevealed: true, finalAnswerVisible: false };
    cb && cb({ ok: true });
    emitSfx(room, 'questionOpen');
    broadcastRoom(room);
  });

  socket.on('admin:finalRevealAnswer', ({ roomId, show } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал не запущен' });
    if (!room.current || !room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Сначала покажите вопрос финала' });
    }
    room.current.finalAnswerVisible = !!show;
    cb && cb({ ok: true });
    broadcastRoom(room);
  });

  socket.on('admin:finalJudge', ({ roomId, playerId, correct } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    if (room.phase !== 'final') return cb && cb({ ok: false, error: 'Финал не запущен' });
    if (!room.current || !room.current.finalRevealed) {
      return cb && cb({ ok: false, error: 'Сначала покажите вопрос финала' });
    }
    const player = room.players.get(playerId);
    if (!player) return cb && cb({ ok: false, error: 'Игрок не найден' });
    const bet = room.finalBets.get(playerId) || 0;

    // re-judging must not add/subtract the bet twice
    const previous = room.finalResults.get(playerId);
    if (previous !== undefined) player.score -= previous ? bet : -bet;

    player.score += correct ? bet : -bet;
    room.finalResults.set(playerId, !!correct);
    cb && cb({ ok: true });
    emitSfx(room, correct ? 'correct' : 'wrong');
    broadcastRoom(room);
  });

  socket.on('admin:finish', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false });
    room.phase = 'finished';
    room.current = null;
    room.boardVisible = false;
    room.buzz = null;
    cb && cb({ ok: true });
    emitSfx(room, 'finish');
    broadcastRoom(room);
  });

  socket.on('admin:resetCatBank', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || room.adminId !== socket.id) return cb && cb({ ok: false, error: 'Нет доступа' });
    const result = resetCatBank();
    socket.emit('catbank:state', result.state);
    cb && cb({ ok: true, changed: result.changed, bank: result.state });
  });

  socket.on('disconnect', () => {
    const { role, roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'player' && playerId && room.players.has(playerId)) {
      const player = room.players.get(playerId);
      player.connected = false;
      player.socketId = null;
    }
    if (role === 'display') room.displayIds.delete(socket.id);
    if (role === 'admin' && room.adminId === socket.id) room.adminId = null;

    broadcastRoom(room);
  });
});

/* ------------------------------------------------------------------ *
 * Редактор паков (HTTP API)
 *
 * Доступ: только с этого компьютера, если не задан editor.token
 * в game.config.json или переменная окружения EDITOR_TOKEN.
 * ------------------------------------------------------------------ */

function isLocalRequest(req) {
  const ip = String(req.socket.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireEditor(req, res, next) {
  // Кастомный заголовок защищает от простых cross-origin form-запросов.
  if (req.get('x-editor-request') !== '1') {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  if (EDITOR_TOKEN) {
    const rawToken = req.get('x-editor-token') || '';
    let token = rawToken;
    try {
      token = decodeURIComponent(rawToken);
    } catch (e) {
      // Если пришёл не URL-encoded токен — сравниваем как есть.
    }
    if (token.normalize('NFC') !== EDITOR_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Требуется токен редактора' });
    }
  } else if (!isLocalRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Редактор доступен только с этого компьютера. Задайте editor.token в game.config.json или EDITOR_TOKEN.'
    });
  }
  next();
}

function safePackFile(name) {
  const safe = path.basename(String(name || ''));
  if (safe === '.json' || !safe.toLowerCase().endsWith('.json')) return null;
  return safe;
}

function safePackBase(name) {
  const base = path.basename(String(name || '')).replace(/\.json$/i, '');
  if (!base || base === '.' || base === '..' || base.startsWith('.')) return null;
  return /^[a-zA-Z0-9._-]+$/.test(base) ? base : null;
}

function readPackForEditor(file) {
  const raw = fs.readFileSync(path.join(QUESTIONS_DIR, file), 'utf-8');
  return JSON.parse(stripJsonComments(raw));
}

/** Имена картинок, на которые ссылается пак (только файлы его папки). */
function packImageReferences(pack, packBase) {
  const referenced = new Set();
  const add = (image) => {
    if (!image) return;
    const src = typeof image === 'string' ? image : image.src;
    if (!src) return;
    const clean = String(src).replace(/^\/+/, '');
    const prefix = `images/questions/${packBase}/`;
    if (!clean.startsWith(prefix)) return;
    referenced.add(path.basename(clean));
  };

  for (const roundKey of ['round1', 'round2', 'round3']) {
    const round = pack && pack[roundKey];
    if (!round || !Array.isArray(round.categories)) continue;
    for (const category of round.categories || []) {
      for (const question of (category && category.questions) || []) {
        add(question && question.images && question.images.question);
        add(question && question.images && question.images.answer);
        add(question && question.images && question.images.original);
      }
    }
  }

  const themes = pack && pack.final && Array.isArray(pack.final.themes) ? pack.final.themes : [];
  for (const theme of themes) {
    add(theme && theme.images && theme.images.question);
    add(theme && theme.images && theme.images.answer);
    add(theme && theme.images && theme.images.original);
  }

  return referenced;
}

/**
 * Удаляет старые сгенерированные картинки пака, на которые больше нет ссылок
 * в сохранённом JSON. Вызывается после успешного сохранения пака.
 */
function cleanupPackImages(pack, packBase) {
  const referenced = packImageReferences(pack, packBase);
  const folder = path.join(IMAGES_ROOT, packBase);
  const pattern = /^(?:r[1-3]-c[1-6]-q[1-5]|final-t[1-7])-(?:question|answer|original)-[a-f0-9]{10}\.webp$/;
  const removed = [];

  if (!fs.existsSync(folder)) return removed;

  for (const name of fs.readdirSync(folder)) {
    if (!pattern.test(name) || referenced.has(name)) continue;
    try {
      fs.unlinkSync(path.join(folder, name));
      removed.push(name);
    } catch (e) { /* ignore */ }
  }

  return removed;
}

/**
 * Убирает временные файлы, которые могли остаться после сбоя записи.
 * Не трогает сами паки и картинки: только *.json.tmp и *.webp.tmp.
 */
function cleanupEditorTemps() {
  try {
    for (const name of fs.readdirSync(QUESTIONS_DIR)) {
      if (!name.endsWith('.json.tmp')) continue;
      try { fs.unlinkSync(path.join(QUESTIONS_DIR, name)); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  try {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.webp.tmp')) {
          try { fs.unlinkSync(full); } catch (e) { /* ignore */ }
        }
      }
    };
    walk(IMAGES_ROOT);
  } catch (e) { /* ignore */ }
}

cleanupEditorTemps();

app.get('/api/editor/status', (req, res) => {
  if (req.get('x-editor-request') !== '1') {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  res.json({
    ok: true,
    tokenRequired: !!EDITOR_TOKEN,
    local: isLocalRequest(req),
    maxBytes: IMAGE_MAX_BYTES,
    maxWidth: IMAGE_MAX_WIDTH,
    maxHeight: IMAGE_MAX_HEIGHT
  });
});

app.get('/api/editor/packs', requireEditor, (req, res) => {
  const packs = listQuestionPacks().map(({ id, name }) => {
    let title = name;
    try {
      title = readPackForEditor(id).title || name;
    } catch (e) {
      // Битый пак всё равно показываем в списке — его можно открыть и исправить.
    }
    return { file: id, title };
  });
  res.json({ ok: true, packs });
});

app.get('/api/editor/pack/:file', requireEditor, (req, res) => {
  const file = safePackFile(req.params.file);
  if (!file) return res.status(400).json({ ok: false, error: 'Некорректное имя файла' });
  try {
    const pack = readPackForEditor(file);
    res.json({ ok: true, file, pack });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

app.put('/api/editor/pack/:file', requireEditor, express.json({ limit: '4mb' }), (req, res) => {
  const file = safePackFile(req.params.file);
  if (!file) return res.status(400).json({ ok: false, error: 'Некорректное имя файла' });
  const pack = req.body && req.body.pack;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return res.status(400).json({ ok: false, error: 'Нет данных пака' });
  }

  try {
    const normalized = validatePack(pack, file);
    const full = path.join(QUESTIONS_DIR, file);
    if (!full.startsWith(QUESTIONS_DIR + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Некорректный путь к паку' });
    }

    const json = JSON.stringify(normalized, null, 2) + '\n';
    const tmp = full + '.tmp';
    // Намеренно без .bak: редактор не должен оставлять лишних файлов.
    fs.writeFileSync(tmp, json, 'utf-8');
    try {
      fs.renameSync(tmp, full);
    } catch (e) {
      // На Windows rename поверх существующего файла иногда может не сработать.
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      fs.writeFileSync(full, json, 'utf-8');
    }

    let removed = [];
    const packBase = safePackBase(file);
    if (packBase) {
      try {
        removed = cleanupPackImages(normalized, packBase);
      } catch (e) {
        console.warn('Не удалось удалить старые картинки пака:', e.message);
      }
    }

    io.emit('packs:list', listQuestionPacks());
    res.json({ ok: true, file, title: normalized.title, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

const editorUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|pjpeg|webp|avif)$/i.test(file.mimetype || '')) {
      return cb(new Error('Поддерживаются PNG, JPEG, WebP и AVIF'));
    }
    cb(null, true);
  }
});

app.post('/api/editor/upload', requireEditor, editorUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Файл не получен' });

    const packBase = safePackBase(req.body.pack);
    if (!packBase) return res.status(400).json({ ok: false, error: 'Некорректное имя пака' });

    const slot = String(req.body.slot || '');
    if (!/^(?:r[1-3]-c[1-6]-q[1-5]|final-t[1-7])-(?:question|answer|original)$/.test(slot)) {
      return res.status(400).json({ ok: false, error: 'Некорректный слот картинки' });
    }

    const folder = path.join(IMAGES_ROOT, packBase);
    fs.mkdirSync(folder, { recursive: true });

    const hash = crypto.createHash('sha1').update(req.file.buffer).digest('hex').slice(0, 10);
    const filename = `${slot}-${hash}.webp`;
    const full = path.join(folder, filename);
    const tmp = `${full}.tmp`;

    let info;
    try {
      info = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: IMAGE_MAX_WIDTH,
          height: IMAGE_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: IMAGE_QUALITY, effort: 4 })
        .toFile(tmp);

      if (fs.existsSync(full)) {
        // Тот же файл уже сохранён (совпал хеш) — оставляем существующий.
        fs.unlinkSync(tmp);
      } else {
        fs.renameSync(tmp, full);
      }
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw e;
    }

    // Старые файлы не удаляем сразу: пак может быть ещё не сохранён.
    // Неиспользуемые картинки удаляются отдельной кнопкой очистки.

    res.json({
      ok: true,
      path: `/images/questions/${packBase}/${filename}`,
      width: info.width,
      height: info.height,
      size: info.size
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Не удалось обработать картинку' });
  }
});

app.post('/api/editor/cleanup-images/:file', requireEditor, express.json({ limit: '4mb' }), (req, res) => {
  const file = safePackFile(req.params.file);
  if (!file) return res.status(400).json({ ok: false, error: 'Некорректное имя файла' });

  const packBase = safePackBase(file);
  if (!packBase) return res.status(400).json({ ok: false, error: 'Некорректное имя пака' });

  let pack;
  try {
    pack = (req.body && req.body.pack) || readPackForEditor(file);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const packShapeOk = pack && typeof pack === 'object' && !Array.isArray(pack)
    && pack.round1 && Array.isArray(pack.round1.categories)
    && pack.round2 && Array.isArray(pack.round2.categories)
    && pack.round3 && Array.isArray(pack.round3.categories)
    && pack.final && Array.isArray(pack.final.themes);
  if (!packShapeOk) {
    return res.status(400).json({ ok: false, error: 'Некорректная структура пака для очистки' });
  }

  try {
    const removed = cleanupPackImages(pack, packBase);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Ошибки multer/json для редактора — в JSON, а не в HTML.
app.use('/api/editor', (err, req, res, next) => {
  if (err) return res.status(400).json({ ok: false, error: err.message || 'Ошибка загрузки' });
  next();
});

/* ------------------------------------------------------------------ *
 * Housekeeping / fallback route / start
 * ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;

// Remove abandoned rooms so the lobby list does not grow forever.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, room] of rooms) {
    const playersOnline = Array.from(room.players.values()).some((p) => p.connected);
    const empty = !playersOnline && !room.adminId && room.displayIds.size === 0;
    const staleLobby = empty && now - (room.createdAt || now) > 2 * HOUR;
    const staleFinished = room.phase === 'finished' && now - (room.lastActivity || room.createdAt || now) > 30 * 60 * 1000;
    if (staleLobby || staleFinished) {
      rooms.delete(id);
      changed = true;
    }
  }
  if (changed) emitRoomsList(true);
}, 5 * 60 * 1000).unref();

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Закройте старый процесс или укажите другой порт (PORT=... или "port" в game.config.json).`);
    process.exit(1);
  }
  throw e;
});

function shutdown() {
  console.log('Останавливаем сервер…');
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
