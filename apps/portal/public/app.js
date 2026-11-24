const $ = (selector) => document.querySelector(selector);
const gamesEl = $('#games');
const lanEl = $('#lanUrl');
const toastEl = $('#toast');
const qrDialog = $('#qrDialog');
const qrImg = $('#qrImg');

const host = location.hostname || 'localhost';
const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
let publicHost = host;
let lanUrl = location.origin;
let renderedSignature = '';
let currentGames = [];
let toastTimer = null;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

const isLoopback = (value) => ['localhost', '127.0.0.1', '::1', '[::1]']
  .includes(value.toLowerCase());

function gameUrl(game) {
  return `${protocol}//${publicHost}:${game.port}/`;
}

function statusText(game) {
  if (game.status === 'soon') return 'скоро';
  return game.online ? 'онлайн' : 'офлайн';
}

function renderGames(games) {
  gamesEl.setAttribute('aria-busy', 'false');
  gamesEl.innerHTML = games.map((game, index) => {
    const soon = game.status === 'soon';
    const tag = soon ? 'article' : 'a';
    const link = soon ? '' : ` href="${gameUrl(game)}"`;
    const arrow = soon ? '·' : '→';
    const label = `${game.title} — ${game.players} игроков, ${game.duration}${soon ? ', скоро' : ''}`;

    return `
    <${tag} class="card${game.online ? '' : ' is-offline'}${soon ? ' is-soon' : ''}"
             ${link}
             data-game="${escapeHtml(game.id)}"
             aria-label="${escapeHtml(label)}"
             style="--accent:${escapeHtml(game.accent || '#f0b429')}; --i:${index}">
      <div class="card-top">
        <span class="index">${String(index + 1).padStart(2, '0')}</span>
        <span class="status" data-online="${soon ? 'soon' : Boolean(game.online)}">
          <i></i><span>${statusText(game)}</span>
        </span>
      </div>
      <div class="monogram" aria-hidden="true">${escapeHtml(game.monogram || '?')}</div>
      <h2>${escapeHtml(game.title)}</h2>
      <p class="tagline">${escapeHtml(game.tagline)}</p>
      <div class="card-bottom">
        <span class="meta">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 19v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1"/><path d="M17 7a3 3 0 0 1 0 6"/><path d="M18 14.5a4 4 0 0 1 3 3.9V19"/></svg>
          ${escapeHtml(game.players)}
        </span>
        <span class="meta">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>
          ${escapeHtml(game.duration)}
        </span>
        <span class="arrow" aria-hidden="true">${arrow}</span>
      </div>
    </${tag}>
  `;
  }).join('');
}

function updateStatuses(games) {
  for (const game of games) {
    const card = [...gamesEl.querySelectorAll('.card')]
      .find((element) => element.dataset.game === game.id);
    if (!card) continue;

    const soon = game.status === 'soon';
    card.classList.toggle('is-offline', !game.online);
    card.classList.toggle('is-soon', soon);

    const status = card.querySelector('.status');
    status.dataset.online = soon ? 'soon' : String(Boolean(game.online));
    status.querySelector('span').textContent = statusText(game);

    if (card.tagName === 'A') card.href = gameUrl(game);
  }
}

function applyGames(games) {
  currentGames = games;
  $('#gameCount').textContent = String(games.length).padStart(2, '0');

  const signature = games
    .map(({ online, ...game }) => JSON.stringify(game))
    .join('|');
  if (signature !== renderedSignature) {
    renderedSignature = signature;
    renderGames(games);
  } else {
    updateStatuses(games);
  }
}

async function loadGames() {
  try {
    const response = await fetch('/api/games', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const games = Array.isArray(data.games) ? data.games : [];
    if (!games.length) throw new Error('empty registry');
    applyGames(games);
  } catch (error) {
    console.error('games:', error);
    if (!renderedSignature) {
      gamesEl.setAttribute('aria-busy', 'false');
      gamesEl.innerHTML = '<div class="loading">Не удалось загрузить игры.</div>';
    }
  }
}

async function loadNetwork() {
  try {
    const response = await fetch('/api/net', { cache: 'no-store' });
    if (!response.ok) return;
    const info = await response.json();
    if (info.ip) {
      lanUrl = `http://${info.ip}:${info.port}/`;
      if (isLoopback(host)) publicHost = info.ip;
    }
    lanEl.textContent = lanUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (currentGames.length) applyGames(currentGames);
  } catch {
    lanEl.textContent = location.host;
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
}

async function copyLanUrl() {
  try {
    await navigator.clipboard.writeText(lanUrl);
  } catch {
    const field = document.createElement('textarea');
    field.value = lanUrl;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  showToast('Скопировано');
}

function openQr() {
  qrImg.src = `/qr?text=${encodeURIComponent(lanUrl)}`;
  $('#qrUrl').textContent = lanUrl;
  qrDialog.showModal();
}

$('#copyLan').addEventListener('click', copyLanUrl);
$('#showQr').addEventListener('click', openQr);
$('#closeQr').addEventListener('click', () => qrDialog.close());
qrDialog.addEventListener('click', (event) => {
  if (event.target === qrDialog) qrDialog.close();
});

$('#year').textContent = new Date().getFullYear();

loadGames();
loadNetwork();

setInterval(() => {
  if (!document.hidden) loadGames();
}, 5000);
