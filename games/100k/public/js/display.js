import { connectWS, qs, esc, phaseName, teamName, typeName, summaryHtml } from './common.js';
import { playSound, unlockSound, setSoundEnabled, setVolume } from './sound.js';

const params = new URLSearchParams(location.search);
const roomId = params.get('room') || sessionStorage.getItem('si_room');
if (params.get('room')) sessionStorage.setItem('si_room', roomId);

if (!roomId) {
  document.body.innerHTML = '<div class="container"><div class="card"><h2>Нет комнаты</h2><p class="muted">Откройте экран для ТВ из админ-панели.</p></div></div>';
  throw new Error('no room');
}

let state = null;
let boardSig = '';
let strikeSig = '';
let soundInitialized = false;
let lanBase = '';

fetch('/api/net')
  .then((r) => r.json())
  .then((d) => {
    if (d && d.ip) {
      lanBase = `http://${d.ip}:${d.port || location.port || 80}`;
      if (state) {
        const el = qs('#lobby');
        if (el) el.dataset.sig = '';
        render();
      }
    }
  })
  .catch(() => { /* не критично */ });

const ws = connectWS(onMessage);
ws.send('DISPLAY_JOIN', { roomId });

const soundBtn = qs('#soundToggle');
let soundOn = true;
soundBtn.onclick = () => {
  soundOn = !soundOn;
  setSoundEnabled(soundOn);
  if (soundOn) {
    unlockSound();
    soundBtn.textContent = '🔊';
  } else {
    soundBtn.textContent = '🔇';
  }
};
document.addEventListener('click', () => unlockSound(), { once: true });

function onMessage(msg) {
  if (msg.type === 'ROOM_STATE') { state = msg.payload; render(); }
  if (msg.type === 'EVENT') {
    playSound(msg.payload.name);
    if (msg.payload.name === 'duplicate') {
      const big = qs('#big');
      if (big) {
        big.classList.add('flash');
        setTimeout(() => big.classList.remove('flash'), 900);
      }
    }
  }
  if (msg.type === 'ERROR') {
    console.error(msg.payload.message);
    if (/не найдена/i.test(msg.payload.message || '')) {
      document.body.innerHTML = `<div class="container"><div class="card">
        <h2>Комната не найдена</h2>
        <p class="muted">Откройте экран для ТВ заново из панели администратора.</p>
      </div></div>`;
    }
  }
}

function render() {
  if (!state) return;
  const s = state;

  if (!soundInitialized && s.settings?.sound) {
    soundInitialized = true;
    soundOn = s.settings.sound.enabled !== false;
    setSoundEnabled(soundOn);
    setVolume(s.settings.sound.volume ?? 0.8);
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
  }

  const t1 = s.teams.find((t) => t.id === 'team1') || { id: 'team1', name: 'Команда 1', score: 0, strikes: 0 };
  const t2 = s.teams.find((t) => t.id === 'team2') || { id: 'team2', name: 'Команда 2', score: 0, strikes: 0 };

  qs('#team1 .name').textContent = t1.name;
  qs('#team1 .score').textContent = t1.score;
  qs('#team2 .name').textContent = t2.name;
  qs('#team2 .score').textContent = t2.score;
  qs('#team1').classList.toggle('active', s.activeTeamId === 'team1');
  qs('#team2').classList.toggle('active', s.activeTeamId === 'team2');

  renderRoster(qs('#team1 .tv-roster'), orderedTeamPlayers(s, 'team1'), t1.captainId, s.turn?.playerId);
  renderRoster(qs('#team2 .tv-roster'), orderedTeamPlayers(s, 'team2'), t2.captainId, s.turn?.playerId);

  const finished = s.phase === 'finished';
  const showLobby = !s.pack || s.phase === 'lobby';
  const showRound = !!s.round && !finished && !showLobby;
  const isBig = showRound && s.round.type === 'big';
  const showQuestion = showRound && !isBig;
  const showBoard = showQuestion && !!s.round.answers;
  const showStrikes = showBoard && ['play', 'steal'].includes(s.phase) && s.round.type !== 'reverse';

  document.body.classList.toggle('in-faceoff', s.phase === 'faceoff');

  const chips = [`<span class="tv-chip">${esc(s.pack ? s.pack.title : 'Ожидание игры')}</span>`];
  if (s.round) {
    chips.push(`<span class="tv-chip">Раунд ${s.roundIndex + 1} / ${s.pack?.total || 0}</span>`);
    chips.push(`<span class="tv-chip tv-round-type">${esc(typeName(s.round.type))}</span>`);
  } else {
    chips.push(`<span class="tv-chip">${esc(phaseName(s.phase))}</span>`);
  }
  if (s.phase === 'reverse' && s.reverse?.firstTeamId && !s.reverse.resolved) {
    chips.push(`<span class="tv-chip">Первой: ${esc(teamName(s, s.reverse.firstTeamId))}</span>`);
  }
  qs('#roundInfo').innerHTML = chips.join('');
  qs('#fund').textContent = s.round?.fund || 0;

  qs('#lobby').classList.toggle('hidden', !showLobby);
  if (showLobby) renderLobby(s);

  renderFaceoff(s);
  renderTurn(s);
  renderTvHint(s);
  renderTvTimer(s);
  renderMainWinner(s);
  document.body.classList.toggle('show-final', finished);

  qs('#question').classList.toggle('hidden', !showQuestion);
  if (showQuestion) qs('#question').textContent = s.round.text || 'Ведущий читает вопрос…';

  qs('#board').classList.toggle('hidden', !showBoard);
  if (showBoard) renderBoard(s);

  qs('#strikes').classList.toggle('hidden', !showStrikes);
  if (showStrikes) renderStrikes(s, t1, t2);

  qs('#big').classList.toggle('hidden', !isBig);
  if (isBig) renderBig(s);

  qs('#winner').classList.toggle('hidden', !finished);
  if (finished) renderWinner(s);
}

function orderedTeamPlayers(s, teamId) {
  const byId = new Map(s.players.filter((p) => p.teamId === teamId).map((p) => [p.id, p]));
  const order = (s.lineups && s.lineups[teamId]) || [];
  const result = order.map((id) => byId.get(id)).filter(Boolean);
  for (const player of byId.values()) {
    if (!result.includes(player)) result.push(player);
  }
  return result;
}

function renderRoster(el, players, captainId, currentId) {
  if (!el) return;
  const sig = players.map((p) => `${p.id}:${p.name}:${p.connected ? 1 : 0}`).join('|')
    + `:${captainId || ''}:${currentId || ''}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = players.length
    ? players.map((p, index) => `<span class="tv-player ${p.connected ? '' : 'offline'} ${p.id === captainId ? 'captain' : ''} ${p.id === currentId ? 'current' : ''}">${index + 1}. ${p.id === captainId ? '★ ' : ''}${esc(p.name)}</span>`).join('')
    : '<span class="tv-player empty">пока никого</span>';
}

function renderFaceoff(s) {
  const el = qs('#faceoff');
  const f = s.faceoff;
  const show = s.phase === 'faceoff' && !!f;
  el.classList.toggle('hidden', !show);
  if (!show) return;

  const sig = `${f.stage}:${f.buzzedPlayerId || ''}:${f.participants.team1 || ''}:${f.participants.team2 || ''}:${f.secondTeamId || ''}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  const name = (id) => {
    const p = s.players.find((x) => x.id === id);
    return p ? p.name : '—';
  };
  let title = '';
  let sub = '';
  if (f.stage === 'prepare') {
    title = (f.participants.team1 && f.participants.team2)
      ? `${name(f.participants.team1)} и ${name(f.participants.team2)}`
      : 'Ждём участников';
    sub = 'Ведущий читает вопрос…';
  } else if (f.stage === 'buzz') {
    title = (f.participants.team1 && f.participants.team2)
      ? `${name(f.participants.team1)} и ${name(f.participants.team2)}`
      : 'Ждём участников';
    sub = 'Кто быстрее нажмёт кнопку?';
  } else if (f.stage === 'answer') {
    title = `Первым нажал ${name(f.buzzedPlayerId)}`;
    sub = teamName(s, f.buzzedTeamId);
  } else if (f.stage === 'second') {
    title = `Отвечает ${name(f.participants[f.secondTeamId])}`;
    sub = teamName(s, f.secondTeamId);
  } else if (f.stage === 'repeat') {
    title = 'Никто не угадал';
    sub = 'Следующий розыгрыш';
  } else {
    title = 'Розыгрыш завершён';
  }

  el.innerHTML = `
    <span class="faceoff-kicker">Розыгрыш</span>
    <b class="faceoff-title">${esc(title)}</b>
    <span class="faceoff-sub">${esc(sub)}</span>
  `;
}

function renderTurn(s) {
  const el = qs('#turn');
  const show = s.phase === 'play' && !!s.turn;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = `
    <span class="faceoff-kicker">Сейчас отвечает</span>
    <b class="faceoff-title">${esc(s.turn.name || '—')}</b>
    <span class="faceoff-sub">${esc(teamName(s, s.turn.teamId))}</span>
  `;
}

function renderTvHint(s) {
  const el = qs('#tvHint');
  let text = '';
  if (!s.pack || s.phase === 'lobby') {
    text = 'Отсканируйте QR-код и присоединяйтесь. Ответы произносятся вслух.';
  } else if (s.phase === 'faceoff' && s.faceoff) {
    if (s.faceoff.stage === 'prepare') text = 'Ведущий читает вопрос. Приготовьтесь нажать кнопку.';
    else if (s.faceoff.stage === 'buzz') text = 'Участники, нажмите кнопку на телефоне.';
    else if (s.faceoff.stage === 'answer' || s.faceoff.stage === 'second') text = 'Назовите версию ведущему вслух.';
    else if (s.faceoff.stage === 'repeat') text = 'Никто не угадал. Новый розыгрыш.';
  } else if (s.phase === 'play') {
    text = 'Отвечайте вслух — ведущий открывает карточки.';
  } else if (s.phase === 'steal') {
    text = 'Блиц-опрос: капитан выбирает одну версию.';
  } else if (s.phase === 'reverse') {
    if (s.reverse?.stage === 'prepare') text = 'Игра наоборот: ведущий читает вопрос.';
    else if (s.reverse?.stage === 'discussion') text = 'Совещание команд.';
    else if (s.reverse?.stage === 'locked') text = 'Версии зафиксированы. Ведущий открывает карточки…';
    else text = 'Раунд завершён.';
  } else if (s.phase === 'big') {
    if (s.big?.stage === 'done') {
      text = s.big?.result === 'win' ? 'Цель большой игры достигнута!' : 'Большая игра завершена.';
    } else {
      text = 'Большая игра: отвечайте вслух.';
    }
  } else if (s.phase === 'intro') {
    text = 'Раунд завершён.';
  }
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function renderMainWinner(s) {
  const el = qs('#mainWinner');
  const show = !!s.mainWinnerSet && s.phase !== 'finished';
  el.classList.toggle('hidden', !show);
  if (!show) {
    el.textContent = '';
    return;
  }
  el.innerHTML = s.mainWinner
    ? `Основную игру выиграла <b>${esc(teamName(s, s.mainWinner))}</b>`
    : 'Основная игра завершилась вничью';
}

function renderTvTimer(s) {
  const el = qs('#tvTimer');
  const r = s?.reverse;
  const show = s?.phase === 'reverse' && r && r.stage === 'discussion' && r.timerEndsAt;
  el.classList.toggle('hidden', !show);
  if (!show) {
    el.textContent = '';
    return;
  }
  const left = Math.max(0, Math.ceil((r.timerEndsAt - Date.now()) / 1000));
  el.textContent = left > 0 ? `${left} с` : 'Время вышло';
}

setInterval(() => {
  if (state) renderTvTimer(state);
  updateTvBigClock();
}, 250);


function renderLobby(s) {
  const el = qs('#lobby');
  const base = (['localhost', '127.0.0.1'].includes(location.hostname) && lanBase) ? lanBase : location.origin;
  const joinUrl = `${base}/?room=${encodeURIComponent(s.room.id)}`;
  const qrSrc = `/qr?text=${encodeURIComponent(joinUrl)}`;
  const sig = `${s.room.id}|${qrSrc}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = `
    <div class="pass">
      <div class="pass-main">
        <div class="pass-kicker">Пропуск в студию</div>
        <div class="room-code">Комната <b>${esc(s.room.id)}</b></div>
        <div class="qr-title">Наведите камеру телефона на QR-код</div>
        <div class="qr-url">${esc(joinUrl)}</div>
      </div>
      <div class="pass-qr">
        <img src="${qrSrc}" alt="QR-код для входа в комнату" />
      </div>
    </div>
  `;
}

function renderBoard(s) {
  const el = qs('#board');
  const sig = `${s.roundIndex}|${s.round.type}|${s.round.text}`;
  if (boardSig !== sig) {
    boardSig = sig;
    el.innerHTML = s.round.answers.map((a, i) => `
      <div class="tv-card" data-i="${i}">
        <div class="tv-card-inner">
          <div class="tv-face tv-front">${i + 1}</div>
          <div class="tv-face tv-back"><span class="tv-answer"></span><span class="tv-points"></span></div>
        </div>
      </div>
    `).join('');
  }

  s.round.answers.forEach((a, i) => {
    const card = el.querySelector(`.tv-card[data-i="${i}"]`);
    if (!card) return;
    card.classList.toggle('revealed', !!a.revealed);
    const ans = card.querySelector('.tv-answer');
    const pts = card.querySelector('.tv-points');
    if (ans) ans.textContent = a.revealed ? a.text : '';
    if (pts) pts.textContent = a.revealed ? a.points : '';
  });
}

function renderStrikes(s, t1, t2) {
  const el = qs('#strikes');
  const activeId = s.controlTeamId || s.activeTeamId;
  const team = activeId === 'team2' ? t2 : activeId === 'team1' ? t1 : null;
  const max = s.settings.maxStrikes || 3;
  const n = team ? Math.max(0, Math.min(max, team.strikes || 0)) : 0;
  const sig = `${activeId}:${n}:${max}`;
  if (sig === strikeSig) return;
  strikeSig = sig;
  el.innerHTML = Array.from({ length: max }, (_, i) =>
    `<div class="tv-strike${i < n ? ' filled' : ''}">✕</div>`
  ).join('');
}

function renderBig(s) {
  const el = qs('#big');
  const b = s.big;
  const show1 = !!b.checked1;
  const show2 = !!b.checked2;
  const stage = b.stage === 'player1'
    ? 'Отвечает игрок 1'
    : b.stage === 'player2'
      ? 'Отвечает игрок 2'
      : 'Итог';
  let rows = '';
  for (let i = 0; i < 5; i++) {
    const v1 = show2 ? b.answers1[i] : '';
    const v2 = show2 ? b.answers2[i] : '';
    const p1 = show1 && b.points1?.[i] != null ? b.points1[i] : '';
    const p2 = show2 && b.points2?.[i] != null ? b.points2[i] : '';
    const dup = show2 && !!(b.duplicates2 && b.duplicates2[i]);
    rows += `<tr class="${dup ? 'big-duplicate' : ''}">
      <td>Вопрос ${i + 1}</td>
      <td>${esc(v1)}</td>
      <td>${p1}</td>
      <td>${esc(v2)}</td>
      <td>${p2}${dup ? ' <span class="dup-mark">повтор</span>' : ''}</td>
    </tr>`;
  }
  const resultHtml = b.result
    ? `<div class="big-result ${b.result}">${b.result === 'win'
      ? `Цель достигнута: ${b.total} из ${s.settings.bigGameTarget || 200}`
      : `Цель не достигнута: ${b.total} из ${s.settings.bigGameTarget || 200}`}</div>`
    : '';
  el.innerHTML = `
    <div class="big-head">
      <div>
        <div class="big-kicker">Большая игра</div>
        <div class="big-players">${esc(b.player1 || 'Игрок 1')} <span>и</span> ${esc(b.player2 || 'Игрок 2')}</div>
        <div class="big-stage">${esc(stage)}</div>
        <div class="big-timer" id="bigTimer"></div>
      </div>
      <div class="big-total">
        <b>${esc(b.total || 0)}</b>
        <span>из ${esc(s.settings.bigGameTarget || 200)}</span>
      </div>
    </div>
    ${resultHtml}
    <table class="big-table">
      <thead><tr><th>Вопрос</th><th>Игрок 1</th><th>Очки</th><th>Игрок 2</th><th>Очки</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  updateTvBigClock();
}

function updateTvBigClock() {
  const el = qs('#bigTimer');
  if (!el) return;
  const b = state?.big;
  if (!b) { el.textContent = ''; return; }
  if (b.timerEndsAt && b.timerPlayer) {
    const left = Math.max(0, Math.ceil((b.timerEndsAt - Date.now()) / 1000));
    el.textContent = left > 0
      ? `Игрок ${b.timerPlayer}: ${left} с`
      : `Время игрока ${b.timerPlayer} вышло`;
    return;
  }
  if (b.stage === 'player1') el.textContent = `Таймер игрока 1: ${b.seconds1 || 20} с`;
  else if (b.stage === 'player2') el.textContent = `Таймер игрока 2: ${b.seconds2 || 30} с`;
  else el.textContent = '';
}

function renderWinner(s) {
  const el = qs('#winner');
  const winnerId = s.mainWinnerSet ? s.mainWinner : s.winner;
  const winner = winnerId ? s.teams.find((t) => t.id === winnerId) : null;
  const sorted = [...s.teams].sort((a, b) => b.score - a.score);
  el.innerHTML = `
    <div class="winner-kicker">Игра завершена</div>
    <div class="winner-title">${winner ? esc(winner.name) : 'Ничья'}</div>
    <div class="winner-label">${winner ? 'победитель основной игры' : 'команды набрали поровну'}</div>
    <div class="winner-scores">
      ${sorted.map((t) => `
        <div class="winner-score ${t.id === winnerId ? 'first' : ''}">
          <span>${esc(t.name)}</span>
          <b>${t.score}</b>
        </div>
      `).join('')}
    </div>
    <div class="winner-summary-title">Вопросы, ответы и результаты</div>
    ${summaryHtml(s)}
  `;
}
