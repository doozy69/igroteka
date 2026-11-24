import { connectWS, qs, qsa, esc, phaseName, teamName, typeName, summaryHtml } from './common.js';

const roomId = sessionStorage.getItem('si_room');
const adminToken = sessionStorage.getItem('si_admin_token');

if (!roomId || !adminToken) {
  document.body.innerHTML = `<div class="container"><div class="card"><h2>Нет комнаты</h2><p class="muted">Создайте игру на <a href="/">главной странице</a>.</p></div></div>`;
  throw new Error('no room');
}

let state = null;
let packs = [];
let changingPack = false;

const ws = connectWS(onMessage);
ws.send('ADMIN_JOIN', { roomId, adminToken });

/* ------------------------------------------------------------------ */
/* Вспомогательные                                                     */
/* ------------------------------------------------------------------ */

function onMessage(msg) {
  if (msg.type === 'ROOM_STATE') { state = msg.payload; render(); }
  if (msg.type === 'PACKS_LIST') { packs = msg.payload; renderPacks(); }
  if (msg.type === 'ERROR') {
    const text = msg.payload.message || 'Ошибка';
    showToast(text);
    if (/не найдена|токен/i.test(text)) {
      sessionStorage.removeItem('si_room');
      sessionStorage.removeItem('si_admin_token');
      document.body.innerHTML = `<div class="container"><div class="card">
        <h2>Комната недоступна</h2>
        <p class="muted">${esc(text)}</p>
        <p><a class="btn-link" href="/">Создать новую игру</a></p>
      </div></div>`;
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
  showToast._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function focusSelector(el) {
  if (!el || !(el instanceof HTMLElement)) return null;
  if (el.id) return '#' + el.id;
  if (el.dataset.teamName) return `[data-team-name="${el.dataset.teamName}"]`;
  if (el.dataset.bigStep) return `[data-big-step="${el.dataset.bigStep}"][data-big-q="${el.dataset.bigQ}"]`;
  return null;
}

function captureFocus() {
  const el = document.activeElement;
  const selector = focusSelector(el);
  if (!selector) return null;
  return {
    selector,
    value: el.value,
    start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
    end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null
  };
}

function restoreFocus(saved) {
  if (!saved) return;
  const el = qs(saved.selector);
  if (!el) return;
  el.value = saved.value;
  el.focus();
  if (saved.start != null) {
    try { el.setSelectionRange(saved.start, saved.end ?? saved.start); } catch (e) { /* ignore */ }
  }
}

function playerById(id) {
  return state ? state.players.find((p) => p.id === id) || null : null;
}

function playerName(id) {
  const p = playerById(id);
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

function formatChoices(answers, selected) {
  const options = ['<option value="-1">— мимо —</option>'];
  (answers || []).forEach((a, i) => {
    options.push(`<option value="${i}" ${i === selected ? 'selected' : ''}>${esc(a.text)} — ${a.points}</option>`);
  });
  return options.join('');
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function render() {
  if (!state) return;
  const saved = captureFocus();
  renderMeta();
  renderPacks();
  renderControls();
  renderFaceoff();
  renderQuestion();
  renderSteal();
  renderReverse();
  renderBig();
  renderSummary();
  renderTeams();
  renderPlayers();
  renderLog();
  renderAdminHint();
  updateClock();
  restoreFocus(saved);
}

function renderMeta() {
  qs('#roomCode').textContent = state.room.id;
  qs('#meta').innerHTML = `
    <span class="appbar-room-name">${esc(state.room.name)}</span>
    <span class="appbar-status ${state.room.adminOnline ? 'on' : 'off'}">${state.room.adminOnline ? 'на связи' : 'офлайн'}</span>
    <span class="appbar-tv">экранов ТВ: ${state.room.displayCount}</span>
  `;
  qs('#tvLink').href = `/display?room=${encodeURIComponent(state.room.id)}`;
}

function renderPacks() {
  const sel = qs('#packSelect');
  const current = state?.packId || '';
  const sig = packs.map((p) => p.id + ':' + p.name).join('|') + '::' + current;
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = packs.map((p) => `<option value="${esc(p.id)}" ${p.id === current ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
      || '<option value="">Нет паков</option>';
    sel.dataset.sig = sig;
  }

  const loaded = !!(state && state.pack);
  qs('#packStatus').textContent = loaded
    ? `Пак «${state.pack.title}», раундов: ${state.pack.total}`
    : 'Пак не загружен';
  qs('#packSelect').classList.toggle('hidden', loaded && !changingPack);
  qs('#loadPack').classList.toggle('hidden', loaded && !changingPack);
  qs('#changePack').classList.toggle('hidden', !loaded);
  qs('#changePack').textContent = changingPack ? 'Отмена' : 'Сменить пак';
}

function renderControls() {
  const s = state;
  qs('#phasePill').textContent = phaseName(s.phase);
  qs('#phasePill').className = 'pill' + (s.phase === 'finished' ? '' : ' active');

  const total = s.pack?.total || 0;
  const roundNo = s.roundIndex >= 0 ? s.roundIndex + 1 : 0;
  const parts = [];
  if (s.pack) parts.push(`<span class="round-chip">Раунд ${roundNo} / ${total}</span>`);
  if (s.round) parts.push(`<span class="round-chip">${esc(typeName(s.round.type))}</span>`);
  if (s.round) parts.push(`<span class="round-chip">Банк ${s.round.fund || 0}</span>`);
  if (s.winner) parts.push(`<span class="round-chip accent">Победитель: ${esc(teamName(s, s.winner))}</span>`);
  qs('#roundCounter').innerHTML = parts.join('') || '<span class="muted small">Загрузите пак, чтобы начать игру.</span>';

  const btn = qs('#startRound');
  const isLast = total > 0 && s.roundIndex + 1 >= total;
  if (!s.pack) {
    btn.textContent = 'Начать игру';
    btn.disabled = true;
  } else if (s.phase === 'finished') {
    btn.textContent = 'Игра завершена';
    btn.disabled = true;
  } else if (s.phase === 'lobby') {
    btn.textContent = 'Начать игру';
    btn.disabled = false;
  } else if (s.phase === 'big' && s.big?.stage === 'done') {
    btn.textContent = 'Большая игра завершена';
    btn.disabled = true;
  } else if (s.phase === 'intro' && isLast) {
    btn.textContent = 'Завершить игру';
    btn.disabled = false;
  } else {
    btn.textContent = 'Следующий раунд';
    btn.disabled = false;
  }

  qs('#finishGame').disabled = s.phase === 'finished';
}

function renderFaceoff() {
  const box = qs('#faceoffBox');
  const f = state.faceoff;
  const show = state.phase === 'faceoff' && !!f;
  box.classList.toggle('hidden', !show);
  if (!show) return;

  const status = qs('#faceoffStatus');
  status.className = 'pill';

  if (f.stage === 'prepare') {
    status.textContent = 'Вопрос не показан';
    status.classList.add('warn');
  } else if (f.stage === 'buzz') {
    status.textContent = f.participants.team1 && f.participants.team2 ? 'Ждём нажатия' : 'Нужны участники';
    status.classList.add('active');
  } else if (f.stage === 'answer') {
    status.textContent = `Отвечает: ${playerName(f.buzzedPlayerId)} (${teamName(state, f.buzzedTeamId)})`;
    status.classList.add('active');
  } else if (f.stage === 'second') {
    status.textContent = `Теперь отвечает: ${playerName(f.participants[f.secondTeamId])} (${teamName(state, f.secondTeamId)})`;
    status.classList.add('active');
  } else if (f.stage === 'repeat') {
    status.textContent = 'Никто не угадал';
    status.classList.add('warn');
  } else {
    status.textContent = 'Розыгрыш завершён';
  }

  const buildSelect = (selector, teamId, currentId) => {
    const team = state.teams.find((t) => t.id === teamId);
    const players = orderedTeamPlayers(teamId);
    const sig = `${teamId}:${currentId || ''}:${team ? team.captainId || '' : ''}:${players.map((p) => p.id).join(',')}`;
    const el = qs(selector);
    if (el.dataset.sig !== sig) {
      el.innerHTML = '<option value="">— не выбран —</option>' + players.map((p, index) => `
        <option value="${esc(p.id)}" ${p.id === currentId ? 'selected' : ''}>
          ${index + 1}. ${esc(p.name)}${team && p.id === team.captainId ? ' ★' : ''}
        </option>
      `).join('');
      el.dataset.sig = sig;
    }
    el.disabled = !['prepare', 'buzz', 'repeat'].includes(f.stage);
    el.onchange = () => {
      if (el.value) ws.send('ADMIN_SET_FACEOFF_PLAYER', { teamId, playerId: el.value });
    };
  };

  buildSelect('#faceoffTeam1', 'team1', f.participants.team1);
  buildSelect('#faceoffTeam2', 'team2', f.participants.team2);
  qs('#nextFaceoff').classList.toggle('hidden', f.stage !== 'repeat');
  qs('#resetBuzz').disabled = !['answer', 'second', 'repeat'].includes(f.stage);
  qs('#faceoffMiss').classList.toggle('hidden', !['answer', 'second'].includes(f.stage));
}

function renderQuestion() {
  const s = state;
  const block = qs('#questionBlock');
  const show = !!s.round && s.round.type !== 'big' && s.phase !== 'finished';
  block.classList.toggle('hidden', !show);
  if (!show) return;

  qs('#questionText').textContent = s.round.text || 'Ведущий читает вопрос…';
  const chips = [`<span class="meta-chip">${esc(typeName(s.round.type))}</span>`];
  if (s.round.multiplier > 1) chips.push(`<span class="meta-chip">×${s.round.multiplier}</span>`);
  chips.push(`<span class="meta-chip">Банк ${s.round.fund || 0}</span>`);
  if (s.activeTeamId) chips.push(`<span class="meta-chip accent">${esc(teamName(s, s.activeTeamId))}</span>`);
  qs('#roundMeta').innerHTML = chips.join('');

  const needShow = (s.phase === 'faceoff' && s.faceoff?.stage === 'prepare')
    || (s.phase === 'reverse' && s.reverse?.stage === 'prepare');
  qs('#showQuestionBox').classList.toggle('hidden', !needShow);
  if (needShow) {
    const isReverse = s.phase === 'reverse';
    qs('#showQuestion').textContent = isReverse
      ? 'Показать вопрос и запустить таймер'
      : 'Показать вопрос / Приём ответов';
    qs('#showQuestionHint').textContent = isReverse
      ? 'Прочитайте вопрос вслух, затем покажите его и запустите 20 секунд совещания.'
      : 'Прочитайте вопрос вслух, затем покажите его игрокам и включите кнопки.';
  }

  const f = s.faceoff;
  const actionable = (s.phase === 'faceoff' && f && ['answer', 'second'].includes(f.stage))
    || s.phase === 'play'
    || s.phase === 'steal';

  let stateLabel = '—';
  if (s.phase === 'play') stateLabel = 'открыть';
  else if (s.phase === 'steal' || (s.phase === 'faceoff' && f && ['answer', 'second'].includes(f.stage))) {
    stateLabel = 'выбрать';
  }

  qs('#answers').innerHTML = (s.round.answers || []).map((a) => {
    const disabled = !actionable || (s.phase === 'play' && a.revealed);
    return `
    <button type="button" class="answer-row ${a.revealed ? 'revealed' : ''}" data-reveal="${a.i}" ${disabled ? 'disabled' : ''}>
      <span class="answer-num">${a.i + 1}</span>
      <span class="answer-text">${esc(a.text)}</span>
      <span class="answer-points">${a.points ?? ''}</span>
      <span class="answer-state">${a.revealed ? 'открыт' : stateLabel}</span>
    </button>`;
  }).join('');

  qsa('[data-reveal]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_REVEAL', { index: Number(b.dataset.reveal) });
  });

  const turn = s.phase === 'play' ? s.turn : null;
  qs('#turnInfo').classList.toggle('hidden', !turn);
  if (turn) {
    qs('#turnName').textContent = turn.name || playerName(turn.playerId);
    qs('#turnTeam').textContent = teamName(s, turn.teamId);
    qs('#strikeBtn').textContent = `Страйк: ${teamName(s, s.controlTeamId || turn.teamId)}`;
  }

  let hint = '';
  if (s.phase === 'faceoff' && f) {
    if (f.stage === 'prepare') hint = 'Сначала покажите вопрос. Затем игроки нажмут кнопки.';
    else if (f.stage === 'buzz') hint = 'Ждём, кто первым нажмёт кнопку на телефоне.';
    else if (f.stage === 'answer' || f.stage === 'second') hint = 'Нажмите карточку, которую назвал участник, или «Мимо».';
    else if (f.stage === 'repeat') hint = 'Никто не угадал. Нажмите «Следующие участники».';
  } else if (s.phase === 'play') {
    hint = 'Открывайте карточку текущего игрока. Промах — «Страйк».';
  } else if (s.phase === 'steal') {
    hint = 'Блиц-опрос: нажмите карточку капитана или «Мимо».';
  } else if (s.phase === 'reverse') {
    hint = 'Выберите версии команд в блоке «Игра наоборот».';
  } else if (s.phase === 'intro') {
    hint = 'Раунд завершён.';
  }
  qs('#answersHint').textContent = hint;
}

function renderSteal() {
  const panel = qs('#stealPanel');
  const st = state.steal;
  const show = state.phase === 'steal' && !!st;
  panel.classList.toggle('hidden', !show);
  if (!show) return;

  const players = orderedTeamPlayers(st.teamId);
  const team = state.teams.find((t) => t.id === st.teamId);
  const captain = team && team.captainId ? playerById(team.captainId) : null;
  const key = `${state.roundIndex}:${st.teamId}:${players.map((p) => p.id).join(',')}`;
  if (panel.dataset.key !== key) {
    panel.dataset.key = key;
    panel.innerHTML = `
      <div class="steal-head">
        <div>
          <div class="panel-label">Блиц-опрос</div>
          <h3>${esc(teamName(state, st.teamId))}</h3>
        </div>
        <span class="pill warn">${captain ? `Капитан: ${esc(captain.name)}` : 'Капитан не назначен'}</span>
      </div>
      <p class="muted small">Спросите четыре версии, начиная с последнего игрока в порядке. Затем нажмите карточку, которую выбрал капитан, или «Мимо».</p>
      <div class="steal-roster">${players.map((p, index) => `<span class="steal-player">${index + 1}. ${esc(p.name)}</span>`).join('')}</div>
      <div class="row">
        <button id="stealMiss" class="warn">Мимо / версии нет на табло</button>
      </div>
    `;
    qs('#stealMiss').onclick = () => ws.send('ADMIN_STEAL_MISS');
  }
}

function renderReverse() {
  const card = qs('#reverseCard');
  const show = !!state.round && state.round.type === 'reverse' && state.phase !== 'finished';
  card.classList.toggle('hidden', !show);
  if (!show) return;

  const r = state.reverse || {};
  const team1 = state.teams.find((t) => t.id === 'team1');
  const team2 = state.teams.find((t) => t.id === 'team2');
  const cap1 = team1 && team1.captainId ? playerById(team1.captainId) : null;
  const cap2 = team2 && team2.captainId ? playerById(team2.captainId) : null;
  const first = r.firstTeamId
    ? `<div class="muted">Первой отвечает: <b>${esc(teamName(state, r.firstTeamId))}</b></div>`
    : '';
  qs('#reverseStagePill').textContent = r.stage === 'prepare'
    ? 'Вопрос не показан'
    : r.stage === 'discussion'
      ? 'Совещание'
      : r.stage === 'locked'
        ? 'Версии зафиксированы'
        : 'Итог';
  qs('#reverseStagePill').className = 'pill' + (r.stage === 'resolved' ? '' : ' active');
  const pending = r.stage === 'locked'
    ? `<div class="muted">Версии зафиксированы. Открывайте карточки — раунд завершится после открытия всех шести.</div>`
    : '';
  qs('#reverseInfo').innerHTML = `${first}
    <div class="muted">Очки по строкам: ${state.settings.reversePointsByRank.join(' / ')}</div>
    ${pending}
    ${r.resolved ? `<div class="pill active" style="margin-top:8px">Итог: ${esc(teamName(state, 'team1'))} +${r.p1}, ${esc(teamName(state, 'team2'))} +${r.p2}</div>` : ''}
    ${r.resolved && state.mainWinnerSet ? `<div class="reverse-winner">Победитель основной игры: <b>${state.mainWinner ? esc(teamName(state, state.mainWinner)) : 'ничья'}</b></div>` : ''}`;

  qs('#reverseChoiceLabel1').textContent = cap1 ? `Версия капитана: ${cap1.name}` : 'Версия команды 1';
  qs('#reverseChoiceLabel2').textContent = cap2 ? `Версия капитана: ${cap2.name}` : 'Версия команды 2';

  const answers = state.round.answers || [];
  const sel1 = qs('#reverseChoice1');
  const sel2 = qs('#reverseChoice2');
  const sig = `${state.roundIndex}:${answers.map((a) => a.text).join('|')}:${r.choices?.team1}:${r.choices?.team2}`;
  if (sel1.dataset.sig !== sig) {
    sel1.innerHTML = formatChoices(answers, r.choices?.team1 ?? -1);
    sel2.innerHTML = formatChoices(answers, r.choices?.team2 ?? -1);
    sel1.dataset.sig = sig;
    sel2.dataset.sig = sig;
  }
  const canChoose = r.stage === 'discussion';
  sel1.disabled = !canChoose;
  sel2.disabled = !canChoose;
  sel1.onchange = () => ws.send('ADMIN_REVERSE_CHOICE', { teamId: 'team1', index: Number(sel1.value) });
  sel2.onchange = () => ws.send('ADMIN_REVERSE_CHOICE', { teamId: 'team2', index: Number(sel2.value) });
  qs('#lockReverse').disabled = !canChoose;

  const choosing = r.stage === 'prepare' || r.stage === 'discussion';
  const canOpen = r.stage === 'locked';
  const showCards = canOpen || r.resolved;
  qs('#reverseChoiceGrid').classList.toggle('hidden', !choosing);
  qs('#reverseAnswersHint').classList.toggle('hidden', !showCards);
  qs('#reverseAnswers').classList.toggle('hidden', !showCards);
  qs('#reverseAnswersHint').textContent = canOpen
    ? 'Открывайте все карточки по одной. Очки начисляются за карточки версий. Раунд завершится после открытия всех шести.'
    : r.resolved
      ? 'Раунд завершён.'
      : '';
  const picks = new Map();
  if (r.choices?.team1 >= 0) picks.set(r.choices.team1, 'К1');
  if (r.choices?.team2 >= 0) picks.set(r.choices.team2, 'К2');
  qs('#reverseAnswers').innerHTML = answers.map((a) => {
    const pick = picks.get(a.i) || '';
    return `<button type="button" class="reverse-open-card ${a.revealed ? 'revealed' : ''}" data-reverse-open="${a.i}" ${canOpen && !a.revealed ? '' : 'disabled'}>
      <span class="reverse-open-num">${a.i + 1}</span>
      <span class="reverse-open-text">${esc(a.text)}</span>
      ${pick ? `<span class="reverse-open-pick">${pick}</span>` : ''}
      <span class="reverse-open-points">${a.points ?? ''}</span>
      <span class="reverse-open-state">${a.revealed ? 'открыта' : canOpen ? 'открыть' : 'закрыта'}</span>
    </button>`;
  }).join('');
  qsa('[data-reverse-open]').forEach((btn) => {
    btn.onclick = () => ws.send('ADMIN_REVEAL_REVERSE', { index: Number(btn.dataset.reverseOpen) });
  });

  updateClock();
}

function renderBig() {
  const card = qs('#bigCard');
  const show = !!state.round && state.round.type === 'big' && !!state.big && state.phase !== 'finished';
  card.classList.toggle('hidden', !show);
  if (!show) return;

  const b = state.big;
  const target = state.settings.bigGameTarget;
  const players = state.players;
  const playerSig = players.map((p) => `${p.id}:${p.teamId}:${p.name}`).join('|');

  const fillPlayerSelect = (el, selectedId, which) => {
    const sig = `${playerSig}:${which}:${selectedId || ''}`;
    if (el.dataset.sig !== sig) {
      el.innerHTML = '<option value="">— не выбран —</option>' + players.map((p) => {
        const team = state.teams.find((t) => t.id === p.teamId);
        return `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)} — ${esc(team ? team.name : p.teamId)}</option>`;
      }).join('');
      el.dataset.sig = sig;
    }
    if (el.value !== (selectedId || '')) el.value = selectedId || '';
  };

  fillPlayerSelect(qs('#bigP1'), b.player1Id, 1);
  fillPlayerSelect(qs('#bigP2'), b.player2Id, 2);
  qs('#bigP1').onchange = sendBigPlayers;
  qs('#bigP2').onchange = sendBigPlayers;

  const stageText = b.stage === 'player1' ? 'Ход игрока 1' : b.stage === 'player2' ? 'Ход игрока 2' : 'Итог';
  qs('#bigStage').innerHTML = `<span class="pill ${b.stage === 'done' ? '' : 'active'}">${stageText}</span>`;
  qs('#bigInfo').textContent = (b.stage === 'player1'
    ? 'Выберите двух игроков (обычно из команды-победителя), отметьте ответы первого и нажмите «Проверить игрока 1».'
    : b.stage === 'player2'
      ? `Игрок 1 набрал ${b.total1}. Ответы, которые он уже назвал, отмечены серым — повтор выбрать нельзя.`
      : `Итог: ${b.total} из ${target}.`)
    + (state.mainWinnerSet
      ? ` Основную игру выиграла ${state.mainWinner ? teamName(state, state.mainWinner) : 'ничья'}.`
      : '');

  const resultEl = qs('#bigResult');
  if (b.stage === 'done' && b.result) {
    resultEl.className = 'big-result ' + b.result;
    resultEl.textContent = b.result === 'win'
      ? `Цель достигнута: ${b.total} из ${target}`
      : `Цель не достигнута: ${b.total} из ${target}`;
  } else {
    resultEl.className = 'big-result hidden';
    resultEl.textContent = '';
  }

  const timeSig = `${state.roundIndex}:${b.seconds1}:${b.seconds2}`;
  if (qs('#bigTime1').dataset.sig !== timeSig) {
    qs('#bigTime1').value = String(b.seconds1 || 20);
    qs('#bigTime2').value = String(b.seconds2 || 30);
    qs('#bigTime1').dataset.sig = timeSig;
  }
  qs('#bigTimer1').disabled = b.stage === 'done' || b.stage === 'player2';
  qs('#bigTimer2').disabled = b.stage !== 'player2';
  qs('#bigTimerStop').disabled = !b.timerEndsAt;

  const chipHtml = (opts, selected, step, qIndex) => {
    const stepActive = step === 1 ? b.stage === 'player1' : b.stage === 'player2';
    const blocked = step === 2 && b.checked1 ? (b.choices1?.[qIndex] ?? -1) : -1;
    return `<div class="big-choices" data-big-step="${step}" data-big-q="${qIndex}">
      ${(opts || []).map((a, idx) => {
        const isBlocked = blocked >= 0 && idx === blocked;
        const isSelected = idx === selected && !isBlocked;
        return `<button type="button" class="choice-chip ${isSelected ? 'selected' : ''} ${isBlocked ? 'duplicate-blocked' : ''}"
          data-choice="${idx}" data-blocked="${isBlocked ? 1 : 0}"
          ${isBlocked ? 'aria-disabled="true" title="Этот ответ уже назвал игрок 1"' : (stepActive ? '' : 'disabled')}>
          ${esc(a.text)} <span>${a.points}</span>${isBlocked ? ' <span class="blocked-mark">повтор</span>' : ''}
        </button>`;
      }).join('')}
      <button type="button" class="choice-chip miss ${selected < 0 ? 'selected' : ''}" data-choice="-1" ${stepActive ? '' : 'disabled'}>мимо</button>
    </div>`;
  };

  const questions = state.round.bigQuestions || [];
  qs('#bigTable').innerHTML = `<table class="players-table big-table">
    <thead><tr><th>Вопрос</th><th>${esc(b.player1 || 'Игрок 1')}</th><th>Очки</th><th>${esc(b.player2 || 'Игрок 2')}</th><th>Очки</th></tr></thead>
    <tbody>
      ${questions.map((q) => {
        const c1 = b.choices1?.[q.i] ?? -1;
        const c2 = b.choices2?.[q.i] ?? -1;
        const pts1 = b.checked1 ? (b.points1?.[q.i] ?? '') : '';
        const pts2 = b.checked2 ? (b.points2?.[q.i] ?? '') : '';
        const dup = !!(b.duplicates2 && b.duplicates2[q.i]);
        return `<tr class="${dup ? 'big-duplicate' : ''}">
          <td>${q.i + 1}. ${esc(q.text)}</td>
          <td>${chipHtml(q.answers, c1, 1, q.i)}</td>
          <td>${pts1}</td>
          <td>${chipHtml(q.answers, c2, 2, q.i)}</td>
          <td>${pts2}${dup ? ' <span class="dup-mark">повтор</span>' : ''}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  qsa('.choice-chip').forEach((chip) => {
    chip.onclick = () => {
      const holder = chip.closest('.big-choices');
      if (!holder) return;
      if (chip.dataset.blocked === '1') {
        ws.send('ADMIN_BIG_DUPLICATE');
        showToast('Повтор: этот ответ уже назвал игрок 1.');
        return;
      }
      ws.send('ADMIN_BIG_CHOICE', {
        step: Number(holder.dataset.bigStep),
        qIndex: Number(holder.dataset.bigQ),
        choice: Number(chip.dataset.choice)
      });
    };
  });

  qs('#bigCheck1').classList.toggle('hidden', b.stage !== 'player1');
  qs('#bigCheck2').classList.toggle('hidden', b.stage !== 'player2');
  qs('#bigDuplicate').classList.toggle('hidden', b.stage !== 'player2');
  updateBigClock();
}

function renderSummary() {
  const card = qs('#summaryCard');
  const show = state.phase === 'finished';
  card.classList.toggle('hidden', !show);
  if (!show) return;
  const winnerId = state.mainWinnerSet ? state.mainWinner : state.winner;
  const winner = winnerId ? state.teams.find((t) => t.id === winnerId) : null;
  qs('#summaryWinner').innerHTML = winner
    ? `Победитель основной игры: <b>${esc(winner.name)}</b>`
    : 'Основная игра завершилась вничью';
  qs('#summaryContent').innerHTML = summaryHtml(state);
}

function renderTeams() {
  const canMove = state.phase !== 'finished';
  const canSetCaptain = !!state.canSetCaptain;
  const canTurn = state.phase === 'play';
  const teams = state.teams;

  qs('#teams').innerHTML = teams.map((t) => {
    const players = orderedTeamPlayers(t.id);
    const isActive = state.activeTeamId === t.id;
    const other = teams.find((x) => x.id !== t.id);
    const canStrike = ['play', 'steal'].includes(state.phase)
      && t.id === (state.controlTeamId || state.activeTeamId);
    const roster = players.length
      ? players.map((p, index) => {
          const isCaptain = p.id === t.captainId;
          const isTurn = state.turn && state.turn.playerId === p.id;
          return `<div class="roster-player ${isTurn ? 'current' : ''}">
            <span class="roster-pos">${index + 1}</span>
            <span class="roster-name ${p.connected ? '' : 'offline'}" title="${p.connected ? 'В сети' : 'Не в сети'}">
              ${isCaptain ? '<span class="captain-star" title="Капитан">★</span>' : ''}${esc(p.name)}
            </span>
            <span class="roster-actions">
              ${canTurn ? `<button class="roster-turn ${isTurn ? 'active' : ''}" data-turn-player="${esc(p.id)}" title="Сейчас отвечает">▶</button>` : ''}
              ${canSetCaptain ? `<button class="roster-arrow" data-lineup-team="${esc(t.id)}" data-lineup-player="${esc(p.id)}" data-lineup-dir="up" title="Выше" ${index <= 1 ? 'disabled' : ''}>↑</button>` : ''}
              ${canSetCaptain ? `<button class="roster-arrow" data-lineup-team="${esc(t.id)}" data-lineup-player="${esc(p.id)}" data-lineup-dir="down" title="Ниже" ${index === 0 || index === players.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
              ${canSetCaptain ? `<button class="roster-captain ${isCaptain ? 'active' : ''}" data-captain-player="${esc(p.id)}" data-captain-team="${esc(t.id)}" title="${isCaptain ? 'Капитан команды' : 'Сделать капитаном'}" ${isCaptain ? 'disabled' : ''}>★</button>` : ''}
              ${canMove && other ? `<button class="roster-move" data-move-player="${esc(p.id)}" data-move-team="${esc(other.id)}" title="Перевести в «${esc(other.name)}»">→ ${esc(other.name)}</button>` : ''}
            </span>
          </div>`;
        }).join('')
      : '<div class="roster-empty">Пока никого</div>';

    return `<div class="team-card ${isActive ? 'active' : ''}">
      <div class="team-head">
        <input data-team-name="${t.id}" value="${esc(t.name)}" aria-label="Название команды ${esc(t.name)}">
        <button data-save-name="${t.id}" class="secondary">OK</button>
      </div>
      <div class="team-stat">
        <div class="team-score">${t.score}</div>
        <div class="muted">страйки ${t.strikes} / ${state.settings.maxStrikes}</div>
      </div>
      <div class="team-actions">
        <button data-active="${t.id}" class="secondary" ${isActive ? 'disabled' : ''}>${isActive ? 'Активная' : 'Сделать активной'}</button>
        <button data-award="${t.id}" class="good">Фонд →</button>
        ${canStrike ? `<button data-strike="${t.id}" class="warn">+ страйк</button>` : ''}
        ${canStrike ? `<button data-clear-strike="${t.id}" class="secondary">− страйк</button>` : ''}
      </div>
      <div class="team-roster">
        <div class="roster-label">Состав: ${players.length}</div>
        ${roster}
      </div>
    </div>`;
  }).join('');

  qs('#rosterHint').textContent = !canSetCaptain
    ? 'Игра завершена.'
    : (state.phase === 'lobby'
        ? '★ — капитан, он всегда первый. ↑↓ — порядок остальных. Игроки меняют команду сами до старта; вы можете переводить их в любой момент.'
        : '★ — капитан, он всегда первый. ↑↓ — порядок остальных. ▶ — сейчас отвечает. Игроки больше не могут менять команду сами.');

  qsa('[data-save-name]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.saveName;
      ws.send('ADMIN_SET_TEAM_NAME', { teamId: id, name: qs(`[data-team-name="${id}"]`).value });
    };
  });
  qsa('[data-active]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_SET_ACTIVE_TEAM', { teamId: b.dataset.active });
  });
  qsa('[data-strike]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_ADD_STRIKE', { teamId: b.dataset.strike });
  });
  qsa('[data-clear-strike]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_CLEAR_STRIKE', { teamId: b.dataset.clearStrike });
  });
  qsa('[data-award]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_AWARD_FUND', { teamId: b.dataset.award });
  });
  qsa('[data-move-player]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_MOVE_PLAYER', {
      playerId: b.dataset.movePlayer,
      teamId: b.dataset.moveTeam
    });
  });
  qsa('[data-captain-player]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_SET_CAPTAIN', {
      teamId: b.dataset.captainTeam,
      playerId: b.dataset.captainPlayer
    });
  });
  qsa('[data-lineup-player]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_REORDER_LINEUP', {
      teamId: b.dataset.lineupTeam,
      playerId: b.dataset.lineupPlayer,
      direction: b.dataset.lineupDir
    });
  });
  qsa('[data-turn-player]').forEach((b) => {
    b.onclick = () => ws.send('ADMIN_SET_TURN', { playerId: b.dataset.turnPlayer });
  });
}

function renderPlayers() {
  qs('#players').innerHTML = `<table class="players-table">
    <thead><tr><th>Игрок</th><th>Команда</th><th>Статус</th></tr></thead>
    <tbody>
      ${state.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(teamName(state, p.teamId))}</td><td>${p.connected ? 'онлайн' : 'офлайн'}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted">Пока нет игроков</td></tr>'}
    </tbody>
  </table>`;
}

function renderLog() {
  qs('#log').textContent = (state.log || [])
    .map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.type} ${JSON.stringify(l.data)}`)
    .join('\n');
}

function renderAdminHint() {
  const s = state;
  let text = '';
  if (s.phase === 'lobby') text = 'Проверьте составы, капитанов и порядок. Затем начните игру.';
  else if (s.phase === 'faceoff' && s.faceoff) {
    if (s.faceoff.stage === 'prepare') text = 'Прочитайте вопрос вслух и нажмите «Показать вопрос / Приём ответов».';
    else if (s.faceoff.stage === 'buzz') text = 'Ждём, кто первым нажмёт кнопку на телефоне.';
    else if (s.faceoff.stage === 'answer' || s.faceoff.stage === 'second') text = 'Нажмите карточку, которую назвал участник, или «Мимо».';
    else if (s.faceoff.stage === 'repeat') text = 'Никто не угадал. Нажмите «Следующие участники».';
    else text = 'Розыгрыш завершён.';
  } else if (s.phase === 'play') text = 'Открывайте карточку текущего игрока. Промах — «Страйк». Очередь переходит автоматически.';
  else if (s.phase === 'steal') text = 'Блиц-опрос: нажмите карточку капитана или «Мимо».';
  else if (s.phase === 'reverse') {
    text = s.reverse?.stage === 'prepare'
      ? 'Прочитайте вопрос и запустите таймер. Затем выберите версии команд.'
      : s.reverse?.stage === 'discussion'
        ? 'Совещание идёт. Выберите версии команд и зафиксируйте их.'
        : s.reverse?.stage === 'locked'
          ? 'Версии зафиксированы. Открывайте все карточки — раунд завершится после шести.'
          : 'Игра наоборот завершена.';
  } else if (s.phase === 'big') {
    text = s.big?.stage === 'player1'
      ? 'Выберите игроков и ответы первого. Можно запустить таймер игрока 1. Затем проверьте игрока 1.'
      : s.big?.stage === 'player2'
        ? 'Отметьте ответы второго, следите за повторами и проверьте игрока 2. Таймер — отдельный.'
        : 'Большая игра завершена. Это финальный раунд: нажмите «Завершить» для итогов.';
  } else if (s.phase === 'intro') text = 'Раунд завершён. Нажмите «Следующий раунд».';
  else if (s.phase === 'finished') text = 'Игра завершена.';
  qs('#adminPhaseHint').textContent = text;
}

/* ------------------------------------------------------------------ */
/* Таймер совещания                                                    */
/* ------------------------------------------------------------------ */

function updateClock() {
  const el = qs('#reverseTimer');
  if (!el) return;
  const r = state?.reverse;
  if (!r) { el.textContent = ''; return; }
  if (r.stage === 'prepare') { el.textContent = 'Таймер запустится после показа вопроса.'; return; }
  if (r.stage === 'locked') { el.textContent = 'Версии зафиксированы. Откройте все шесть карточек.'; return; }
  if (r.stage === 'resolved') { el.textContent = 'Совещание завершено.'; return; }
  if (!r.timerEndsAt) { el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((r.timerEndsAt - Date.now()) / 1000));
  el.textContent = left > 0 ? `До конца совещания: ${left} с` : 'Время вышло';
}

function updateBigClock() {
  const el = qs('#bigTimerDisplay');
  if (!el) return;
  const b = state?.big;
  if (!b) { el.textContent = ''; return; }
  if (b.timerEndsAt && b.timerPlayer) {
    const left = Math.max(0, Math.ceil((b.timerEndsAt - Date.now()) / 1000));
    el.textContent = left > 0
      ? `Таймер игрока ${b.timerPlayer}: ${left} с`
      : `Время игрока ${b.timerPlayer} вышло`;
    return;
  }
  if (b.stage === 'player1') {
    el.textContent = `Таймер игрока 1 готов: ${b.seconds1 || 20} с`;
  } else if (b.stage === 'player2') {
    el.textContent = `Таймер игрока 2 готов: ${b.seconds2 || 30} с`;
  } else {
    el.textContent = 'Таймер остановлен.';
  }
}

setInterval(() => {
  updateClock();
  updateBigClock();
}, 250);

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

qs('#loadPack').onclick = () => {
  const packId = qs('#packSelect').value;
  if (!packId) return;
  if (state && state.phase !== 'lobby' && state.phase !== 'finished') {
    if (!confirm('Загрузка пака сбросит текущую игру. Продолжить?')) return;
  }
  ws.send('ADMIN_LOAD_PACK', { packId });
  changingPack = false;
};

qs('#changePack').onclick = () => {
  if (changingPack) {
    changingPack = false;
    renderPacks();
    return;
  }
  changingPack = true;
  renderPacks();
  qs('#packSelect').focus();
};

qs('#startRound').onclick = () => {
  if (!state) return;
  const active = ['faceoff', 'play', 'steal', 'reverse', 'big'].includes(state.phase);
  if (active && !confirm('Текущий раунд не завершён. Начать следующий?')) return;
  const lastRound = state.pack && state.roundIndex + 1 >= state.pack.total;
  if (state.phase === 'intro' && lastRound && !confirm('Завершить игру и показать итоги?')) return;
  ws.send('ADMIN_START_ROUND');
};

qs('#finishGame').onclick = () => {
  if (confirm('Завершить игру и показать итоги?')) ws.send('ADMIN_FINISH');
};

qs('#showQuestion').onclick = () => ws.send('ADMIN_SHOW_QUESTION');
qs('#nextTurn').onclick = () => ws.send('ADMIN_NEXT_TURN');
qs('#faceoffMiss').onclick = () => ws.send('ADMIN_FACEOFF_MISS');
qs('#resetBuzz').onclick = () => ws.send('ADMIN_RESET_BUZZ');
qs('#nextFaceoff').onclick = () => ws.send('ADMIN_NEXT_FACEOFF');

qs('#strikeBtn').onclick = () => {
  const teamId = state?.controlTeamId || state?.turn?.teamId;
  if (!teamId) {
    showToast('Сначала выберите активную команду.');
    return;
  }
  ws.send('ADMIN_ADD_STRIKE', { teamId });
};

qs('#lockReverse').onclick = () => ws.send('ADMIN_LOCK_REVERSE');

function sendBigPlayers() {
  ws.send('ADMIN_BIG_PLAYERS', {
    player1Id: qs('#bigP1').value || null,
    player2Id: qs('#bigP2').value || null
  });
}

qs('#bigCheck1').onclick = () => ws.send('ADMIN_BIG_CHECK1');
qs('#bigCheck2').onclick = () => ws.send('ADMIN_BIG_CHECK2');
qs('#bigDuplicate').onclick = () => ws.send('ADMIN_BIG_DUPLICATE');
qs('#bigScore').onclick = () => ws.send('ADMIN_BIG_SCORE');
qs('#bigTimer1').onclick = () => ws.send('ADMIN_BIG_TIMER', { player: 1, seconds: Number(qs('#bigTime1').value) });
qs('#bigTimer2').onclick = () => ws.send('ADMIN_BIG_TIMER', { player: 2, seconds: Number(qs('#bigTime2').value) });
qs('#bigTimerStop').onclick = () => ws.send('ADMIN_BIG_TIMER_STOP');
