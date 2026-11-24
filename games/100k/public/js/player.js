import { connectWS, qs, esc, phaseName, teamName, typeName } from './common.js';

const roomId = sessionStorage.getItem('si_room');
const playerId = sessionStorage.getItem('si_player');
const playerToken = sessionStorage.getItem('si_player_token');

if (!roomId || !playerId || !playerToken) {
  location.href = '/';
  throw new Error('no player session');
}

let state = null;
const ws = connectWS(onMessage);
ws.send('PLAYER_JOIN', { roomId, playerId, playerToken });

function onMessage(msg) {
  if (msg.type === 'ROOM_STATE') { state = msg.payload; render(); }
  if (msg.type === 'TEAM_CHANGED') {
    sessionStorage.setItem('si_team', msg.payload.teamId);
    const team = state?.teams.find((t) => t.id === msg.payload.teamId);
    showToast(team ? `Вы в команде «${team.name}».` : 'Команда изменена.');
  }
  if (msg.type === 'ERROR') {
    const text = msg.payload.message || 'Ошибка';
    showToast(text);
    if (!state && /не найдена|завершена|Введите имя/i.test(text)) {
      sessionStorage.removeItem('si_room');
      sessionStorage.removeItem('si_player');
      sessionStorage.removeItem('si_player_token');
      setTimeout(() => { location.href = '/'; }, 1200);
    }
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
  showToast._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function playerName(id) {
  const p = state ? state.players.find((x) => x.id === id) : null;
  return p ? p.name : '—';
}

function orderedTeamPlayers(teamId) {
  if (!state) return [];
  const byId = new Map(state.players.filter((p) => p.teamId === teamId).map((p) => [p.id, p]));
  const order = (state.lineups && state.lineups[teamId]) || [];
  const result = order.map((id) => byId.get(id)).filter(Boolean);
  for (const player of byId.values()) {
    if (!result.includes(player)) result.push(player);
  }
  return result;
}

function participantNames(f) {
  const names = [];
  for (const teamId of ['team1', 'team2']) {
    const id = f.participants[teamId];
    if (id) names.push(`${playerName(id)} (${teamName(state, teamId)})`);
  }
  return names.join(' и ') || 'участники не выбраны';
}

function render() {
  if (!state) return;
  const me = state.me;
  const team = me ? state.teams.find((t) => t.id === me.teamId) : null;

  if (me) sessionStorage.setItem('si_team', me.teamId);

  qs('#playerInfo').innerHTML = me
    ? `<b>${esc(me.name)}</b><span>${esc(teamName(state, me.teamId))}</span>`
    : 'Игрок не найден';

  qs('#status').innerHTML = `
    <div class="player-round">${state.round ? `${esc(typeName(state.round.type))} · Раунд ${state.roundIndex + 1} / ${state.pack?.total || 0}` : esc(phaseName(state.phase))}</div>
    <div class="player-team">${team ? esc(team.name) : ''}</div>
    <div class="player-score">${team ? team.score : 0}</div>
    <div class="player-status">${esc(statusText(state))}</div>
  `;

  const isReverse = state.phase === 'reverse' && state.round?.type === 'reverse';
  const isBig = state.phase === 'big' && state.round?.type === 'big';

  qs('#reverseCard').style.display = isReverse ? '' : 'none';
  qs('#bigCard').style.display = isBig ? '' : 'none';

  renderTeamSwitch(me);
  renderBuzz(me);
  if (isReverse) renderReverse(me);
  if (isBig) renderBig(me);
  renderTeamRosters(me);
  updatePlayerTimer();
}

function renderTeamSwitch(me) {
  const card = qs('#teamSwitchCard');
  const canSwitch = !!me && !!state.canChangeTeams;
  card.style.display = canSwitch ? '' : 'none';
  if (!canSwitch) return;

  qs('#teamSwitch').innerHTML = state.teams.map((t) => `
    <button type="button" class="team-choice ${me.teamId === t.id ? 'selected' : ''}" data-team="${esc(t.id)}">
      ${esc(t.name)}
    </button>
  `).join('');

  qs('#teamSwitch').querySelectorAll('[data-team]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.team === me.teamId) return;
      ws.send('PLAYER_SET_TEAM', { teamId: b.dataset.team });
    };
  });
}

function renderBuzz(me) {
  const card = qs('#buzzCard');
  const f = state.faceoff;
  const show = state.phase === 'faceoff' && !!f;
  card.style.display = show ? '' : 'none';
  if (!show) return;

  const qText = state.round?.text || '';
  const qEl = qs('#buzzQuestion');
  qEl.textContent = qText;
  qEl.classList.toggle('hidden', !qText);

  const myTeam = ['team1', 'team2'].find((teamId) => f.participants[teamId] === me?.id) || null;
  const isParticipant = !!myTeam;
  const buzzId = f.buzzedPlayerId;

  let text = '';
  if (f.stage === 'prepare') {
    text = isParticipant
      ? 'Приготовьтесь нажать кнопку «Я отвечаю!».'
      : `Сейчас розыгрыш: ${participantNames(f)}. Приготовьтесь.`;
  } else if (f.stage === 'buzz') {
    if (!isParticipant) {
      text = `Отвечают: ${participantNames(f)}. Кто нажмёт первым?`;
    } else if (buzzId) {
      text = `Первым нажал ${playerName(buzzId)}.`;
    } else {
      text = 'Нажмите кнопку первым!';
    }
  } else if (f.stage === 'answer') {
    text = f.buzzedPlayerId === me?.id
      ? 'Вы нажали первым. Назовите версию ведущему.'
      : `Отвечает ${playerName(f.buzzedPlayerId)}.`;
  } else if (f.stage === 'second') {
    const secondId = f.participants[f.secondTeamId];
    text = secondId === me?.id
      ? 'Теперь ваш ход. Назовите версию ведущему.'
      : `Теперь отвечает ${playerName(secondId)}.`;
  } else if (f.stage === 'repeat') {
    text = 'Никто не угадал. Ведущий начнёт новый розыгрыш.';
  } else {
    text = 'Розыгрыш завершён.';
  }
  qs('#buzzStatus').textContent = text;

  const btn = qs('#buzzButton');
  const canBuzz = isParticipant && f.stage === 'buzz' && !buzzId;
  btn.classList.toggle('hidden', !canBuzz);
  btn.disabled = !canBuzz;
  btn.textContent = 'Я отвечаю!';
  btn.onclick = () => {
    if (!canBuzz) return;
    btn.disabled = true;
    btn.textContent = 'Нажато…';
    ws.send('PLAYER_BUZZ');
  };
}

function renderReverse(me) {
  const qText = state.round?.text || '';
  const qEl = qs('#reverseQuestion');
  qEl.textContent = qText;
  qEl.classList.toggle('hidden', !qText);
  const r = state.reverse || {};
  if (r.stage === 'prepare') {
    qs('#reverseInfo').textContent = 'Слушайте вопрос ведущего. Затем начнётся совещание.';
  } else if (r.stage === 'locked') {
    qs('#reverseInfo').textContent = 'Версии капитанов зафиксированы. Ведущий открывает карточки…';
  } else if (r.resolved) {
    const mainWinner = state.mainWinnerSet
      ? (state.mainWinner ? ` Победитель основной игры — ${teamName(state, state.mainWinner)}.` : ' Основная игра завершилась вничью.')
      : '';
    qs('#reverseInfo').textContent = `${teamName(state, 'team1')} +${r.p1}, ${teamName(state, 'team2')} +${r.p2}.${mainWinner}`;
  } else {
    const first = r.firstTeamId ? `Первой отвечает ${teamName(state, r.firstTeamId)}.` : '';
    qs('#reverseInfo').textContent = `${first} Совещайтесь. Капитан назовёт версию ведущему.`;
  }
  updatePlayerTimer();
}

function updatePlayerTimer() {
  const el = qs('#reverseTimer');
  if (!el) return;
  const s = state;
  const r = s?.reverse;
  if (!r) { el.textContent = ''; return; }
  if (r.stage === 'prepare') {
    el.textContent = 'Таймер запустится после показа вопроса.';
    return;
  }
  if (r.stage === 'resolved') {
    el.textContent = 'Совещание завершено.';
    return;
  }
  if (!r.timerEndsAt) {
    el.textContent = r.stage === 'locked' ? 'Версии зафиксированы.' : '';
    return;
  }
  const left = Math.max(0, Math.ceil((r.timerEndsAt - Date.now()) / 1000));
  el.textContent = left > 0 ? `До конца совещания: ${left} с` : 'Время вышло';
}

function updateBigTimer() {
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

setInterval(() => {
  updatePlayerTimer();
  updateBigTimer();
}, 250);

function renderBig(me) {
  const b = state.big;
  if (!b) return;
  const p1 = b.player1Id === me?.id;
  const p2 = b.player2Id === me?.id;
  let text = 'Сейчас отвечают двое игроков команды.';

  if (p1) {
    text = b.stage === 'player1'
      ? 'Вы отвечаете первым. Назовите ответы ведущему.'
      : 'Ваши ответы приняты.';
  } else if (p2) {
    text = b.stage === 'player1'
      ? 'Подождите своей очереди.'
      : b.stage === 'player2'
        ? 'Ваш ход. Назовите ответы ведущему — они не должны совпадать с ответами первого игрока.'
        : 'Ваши ответы приняты.';
  }
  qs('#bigInfo').textContent = text;
  const resultEl = qs('#bigResult');
  if (b.stage === 'done' && b.result) {
    resultEl.className = 'big-result ' + b.result;
    resultEl.textContent = b.result === 'win'
      ? `Цель достигнута: ${b.total} из ${state.settings.bigGameTarget || 200}`
      : `Цель не достигнута: ${b.total} из ${state.settings.bigGameTarget || 200}`;
  } else {
    resultEl.className = 'big-result hidden';
    resultEl.textContent = '';
  }
  updateBigTimer();
}

function renderTeamRosters(me) {
  qs('#teams').innerHTML = state.teams.map((t) => {
    const players = orderedTeamPlayers(t.id);
    const mine = !!me && me.teamId === t.id;
    return `<div class="roster-team ${mine ? 'mine' : ''}">
      <div class="roster-team-head">
        <span>${esc(t.name)}</span>
        <b>${t.score}</b>
      </div>
      <div class="roster-list">
        ${players.length
          ? players.map((p, index) => {
              const isCaptain = p.id === t.captainId;
              const isTurn = state.turn && state.turn.playerId === p.id;
              return `<span class="roster-chip ${me && p.id === me.id ? 'you' : ''} ${p.connected ? '' : 'offline'} ${isCaptain ? 'captain' : ''} ${isTurn ? 'current' : ''}">
                ${index + 1}. ${isCaptain ? '★ ' : ''}${esc(p.name)}
              </span>`;
            }).join('')
          : '<span class="roster-empty">Пока никого</span>'}
      </div>
    </div>`;
  }).join('');
}

function statusText(s) {
  if (s.phase === 'lobby') return 'Ожидание начала игры.';
  if (s.phase === 'faceoff') {
    if (s.faceoff?.stage === 'prepare') return 'Слушайте вопрос ведущего.';
    if (s.faceoff?.stage === 'buzz') return 'Розыгрыш: нажмите кнопку первым.';
    return 'Розыгрыш идёт.';
  }
  if (s.phase === 'play') {
    if (s.turn) {
      if (s.me && s.turn.playerId === s.me.id) return 'Ваш ход. Назовите ответ ведущему.';
      return `Отвечает ${s.turn.name || '—'}.`;
    }
    return 'Отвечайте ведущему вслух.';
  }
  if (s.phase === 'steal') {
    const mine = s.me && s.steal && s.me.teamId === s.steal.teamId;
    return mine
      ? 'Блиц-опрос: ведущий спросит четыре версии, капитан выберет одну.'
      : 'Блиц-опрос у соперников.';
  }
  if (s.phase === 'reverse') {
    if (s.reverse?.stage === 'prepare') return 'Сейчас будет игра наоборот. Слушайте вопрос.';
    if (s.reverse?.stage === 'locked') return 'Версии зафиксированы. Ведущий открывает карточки.';
    if (s.reverse?.resolved) {
      if (s.mainWinnerSet && s.mainWinner) return `Основную игру выиграла ${teamName(s, s.mainWinner)}.`;
      if (s.mainWinnerSet) return 'Основная игра завершилась вничью.';
      return 'Версии проверены.';
    }
    return 'Совещайтесь. Капитан назовёт версию ведущему.';
  }
  if (s.phase === 'big') {
    if (s.big?.stage === 'done') {
      return s.big?.result === 'win'
        ? `Большая игра выиграна: ${s.big.total} из ${s.settings.bigGameTarget || 200}.`
        : `Большая игра завершена: ${s.big?.total || 0} из ${s.settings.bigGameTarget || 200}.`;
    }
    return 'Большая игра. Отвечайте ведущему вслух.';
  }
  if (s.phase === 'finished') return 'Игра завершена.';
  return phaseName(s.phase);
}
