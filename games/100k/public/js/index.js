import { connectWS, qs, esc, phaseName } from './common.js';

const urlRoom = new URLSearchParams(location.search).get('room');
const savedName = localStorage.getItem('si_name') || '';
if (savedName) qs('#playerName').value = savedName;

let teams = [
  { id: 'team1', name: 'Команда 1' },
  { id: 'team2', name: 'Команда 2' }
];
let rooms = [];

const ws = connectWS(onMessage);
ws.send('LOBBY_SUBSCRIBE');

function onMessage(msg) {
  if (msg.type === 'CONFIG') {
    if (Array.isArray(msg.payload.teams) && msg.payload.teams.length) teams = msg.payload.teams;
    renderTeams();
  }
  if (msg.type === 'ROOMS_LIST') { rooms = msg.payload; renderRooms(); renderBanner(); }
  if (msg.type === 'ROOM_CREATED') {
    sessionStorage.setItem('si_room', msg.payload.roomId);
    sessionStorage.setItem('si_admin_token', msg.payload.adminToken);
    location.href = '/admin';
  }
  if (msg.type === 'JOINED') {
    sessionStorage.setItem('si_room', msg.payload.roomId);
    sessionStorage.setItem('si_player', msg.payload.playerId);
    sessionStorage.setItem('si_player_token', msg.payload.playerToken);
    sessionStorage.setItem('si_name', msg.payload.name);
    sessionStorage.setItem('si_team', msg.payload.teamId);
    localStorage.setItem('si_name', msg.payload.name);
    location.href = '/player';
  }
  if (msg.type === 'ERROR') {
    qs('#createResult').textContent = msg.payload.message;
    showToast(msg.payload.message);
  }
}

function showToast(text) {
  let el = qs('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function renderTeams() {
  const sel = qs('#teamSelect');
  const savedTeam = sessionStorage.getItem('si_team');
  sel.innerHTML = teams.map((t) => `<option value="${esc(t.id)}" ${t.id === savedTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

function renderBanner() {
  const el = qs('#joinBanner');
  if (!urlRoom) { el.classList.add('hidden'); return; }
  const room = rooms.find((r) => r.id === urlRoom);
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="join-banner">
      <div class="join-banner-copy">
        <b>Комната ${esc(urlRoom)}</b>
        <span>${room ? `${esc(room.name)} — ${esc(phaseName(room.phase))}` : 'Комната не найдена — проверьте код'}</span>
      </div>
      <button id="joinUrlRoom" class="primary" ${room ? '' : 'disabled'}>Войти</button>
    </div>`;
  const btn = qs('#joinUrlRoom');
  if (btn) btn.onclick = () => joinRoom(urlRoom);
}

function renderRooms() {
  const el = qs('#roomsList');
  if (!rooms.length) {
    el.innerHTML = '<div class="muted">Пока нет активных комнат. Создайте игру в блоке «Создать игру».</div>';
    return;
  }
  el.innerHTML = rooms.map((r) => `
    <div class="room-item ${urlRoom === r.id ? 'highlight' : ''}">
      <div class="room-main">
        <div class="room-title">
          <b>${esc(r.name)}</b>
          <span class="room-code-chip">${esc(r.id)}</span>
        </div>
        <div class="room-meta">
          <span>${playersLabel(r.players)}</span>
          <span class="room-phase">${esc(phaseName(r.phase))}</span>
          ${r.packTitle ? `<span class="room-pack">${esc(r.packTitle)}</span>` : ''}
        </div>
      </div>
      <button data-id="${esc(r.id)}" class="secondary">Войти</button>
    </div>
  `).join('');

  el.querySelectorAll('button[data-id]').forEach((b) => {
    b.onclick = () => joinRoom(b.dataset.id);
  });
}

function playersLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} игрок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} игрока`;
  return `${n} игроков`;
}

function joinRoom(roomId) {
  const name = qs('#playerName').value.trim();
  if (!name) {
    showToast('Введите имя, чтобы войти в игру.');
    qs('#playerName').focus();
    return;
  }
  const teamId = qs('#teamSelect').value || 'team1';
  ws.send('PLAYER_JOIN', { roomId, name, teamId });
}

qs('#createRoom').onclick = () => {
  ws.send('ADMIN_CREATE_ROOM', { name: qs('#roomName').value.trim() });
};

qs('#playerName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && urlRoom) joinRoom(urlRoom);
});

renderTeams();
