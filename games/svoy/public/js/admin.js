const socket = io();
const roomId = sessionStorage.getItem('si_room');
const adminToken = sessionStorage.getItem('si_admin_token') || '';
const meta = document.getElementById('meta');
if (!roomId) { meta.innerHTML = 'Нет комнаты. <a href="/">На главную</a>'; throw new Error('no room'); }
meta.textContent = 'Комната: ' + roomId;
const tvLink = document.getElementById('tvLink');
if (tvLink) tvLink.href = '/display.html?room=' + encodeURIComponent(roomId);

let state = null, board = null, meAdmin = false;

function mediaPreview(img, label){
  if(!img || !img.src) return '';
  const src = esc(img.src);
  return `<figure class="admin-media"><figcaption>${label}</figcaption>
    <a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(img.alt||'')}" loading="lazy" onerror="this.closest('figure').classList.add('media-broken');this.remove();"></a>
  </figure>`;
}
let gameCfg = { showSpecialMarkersToAdmin: true };

function emit(name, data={}, cb){ socket.emit(name, { roomId, ...data }, cb||(()=>{})); }

socket.on('connect', () => {
  emit('admin:join', { adminToken }, (res) => {
    meAdmin = !!res.ok;
    meta.textContent = `Комната: ${roomId}` + (meAdmin ? ' (вы админ)' : ' (нет прав админа: '+(res.error||'')+')');
    if(!meAdmin){ alert('Нет прав администратора для этой комнаты. Создайте новую комнату на главной странице.'); }
    refresh();
  });
});

function refresh(){
  emit('admin:getState', {}, (res)=>{
    if(res.ok){
      state=res.room; board=res.board;
      if(res.config){ gameCfg = res.config; }
      if(res.catBank){ renderCatBank(res.catBank); }
      renderPacks(res.packs||[]); renderAll();
    }
  });
}

socket.on('game:config', (cfg)=>{ gameCfg = cfg || gameCfg; });
socket.on('catbank:state', renderCatBank);
socket.on('packs:list', renderPacks);
socket.on('room:state', (s)=>{ state=s; renderPlayers(); renderPhase(); renderFinal(); renderFinishAdmin(); });
socket.on('board:state', (b)=>{
  // the admin view is richer; a public view would overwrite it with stripped data
  if(meAdmin && b && b.view === 'public') return;
  board=b; renderBoard(); renderCurrent(); renderPhase(); renderFinal();
});
socket.on('board:hover', (h)=>{ if(!board) return; board.hovered = (h && h.hovered) || null; renderHover(); });
socket.on('rooms:list', ()=>{});

function renderPacks(packs){
  const sel = document.getElementById('packSelect');
  if(!packs.length && sel.options.length) return;
  sel.innerHTML = packs.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') || '<option>Нет паков</option>';
}

/* Банк вопросов «Кота в мешке»: счётчики и статусы файлов. */
function renderCatBank(bank){
  const box = document.getElementById('catBankBox');
  if(!box) return;
  if(!bank){ box.textContent = 'Нет данных о банке.'; return; }

  const files = bank.files || [];
  const perFile = files.map((f) => f.error
    ? `<div class="muted">${esc(f.file)} — ошибка: ${esc(f.error)}</div>`
    : `<div class="muted">${esc(f.file)}: сыграно ${f.played} из ${f.total}</div>`
  ).join('');

  const summary = bank.total === 0
    ? `<div>В папке <b>${esc(bank.dir)}</b> пока нет вопросов. Добавьте JSON-файл с вопросами.</div>`
    : `<div class="big">Всего: <b>${bank.total}</b> · сыграно: <b>${bank.played}</b> · осталось: <b style="color:${bank.remaining > 0 ? '#22c55e' : '#ef4444'}">${bank.remaining}</b></div>
      ${bank.remaining === 0 ? '<div class="muted">Банк исчерпан: «Кот в мешке» не откроется, пока не сбросите статусы или не добавите вопросы.</div>' : ''}`;

  box.innerHTML = `${summary}${perFile ? `<div style="margin-top:6px">${perFile}</div>` : ''}${bank.broken ? `<div class="muted">Файлов с ошибками: ${bank.broken}</div>` : ''}`;
}

document.getElementById('loadPack').onclick = () => {
  if(!meAdmin){ alert('Нет прав администратора. Вернитесь на главную и создайте комнату заново.'); return; }
  const filename = document.getElementById('packSelect').value;
  if(!filename || filename === 'Нет паков'){ document.getElementById('packStatus').textContent = 'Нет доступных паков в папке questions/'; return; }
  if(state && state.phase !== 'lobby' && !confirm('Загрузка нового пака сбросит текущую игру и очки. Продолжить?')) return;
  emit('admin:selectPack', { filename }, (res)=>{
    document.getElementById('packStatus').textContent = res.ok ? ('Загружен: '+res.title) : (res.error||'Ошибка');
    if(!res.ok && res.error === 'Нет доступа'){ alert('Нет доступа: эта вкладка не является администратором комнаты. Создайте комнату заново на главной странице.'); }
  });
};
document.getElementById('startR1').onclick = ()=>emit('admin:startRound',{round:1});
document.getElementById('startR2').onclick = ()=>emit('admin:startRound',{round:2});
document.getElementById('startR3').onclick = ()=>emit('admin:startRound',{round:3});
document.getElementById('startFinal').onclick = ()=>emit('admin:startRound',{round:'final'});
document.getElementById('finishGame').onclick = ()=>{
  if(confirm('Завершить игру?')) emit('admin:finish');
};
document.getElementById('resetCatBank').onclick = ()=>{
  if(!confirm('Сбросить статусы всех вопросов банка «Кот в мешке»?')) return;
  emit('admin:resetCatBank', {}, (res)=>{
    if(res && !res.ok){ alert(res.error || 'Не удалось сбросить статусы'); return; }
    if(res && res.bank) renderCatBank(res.bank);
  });
};

function renderPhase(){
  const names = {lobby:'Лобби',round1:'1 раунд',round2:'2 раунд',round3:'3 раунд',round1_done:'1 раунд завершён',round2_done:'2 раунд завершён',round3_done:'3 раунд завершён',final:'Финал',finished:'Игра завершена'};
  document.getElementById('phaseInfo').textContent = state ? `Фаза: ${names[state.phase] || state.phase}${state.packTitle? ' · Пак: '+state.packTitle:''}` : '';
}
function renderPlayers(){
  if(!state) return;
  const el = document.getElementById('playersAdmin');
  if(!state.players.length){ el.innerHTML='<div class="muted">Пока нет игроков</div>'; return; }

  // keep the caret/value in the score input while a table is re-rendered
  const active = document.activeElement;
  const focusedId = active && el.contains(active) && active.id ? active.id : null;
  const typed = {};
  el.querySelectorAll('input[data-score]').forEach(inp => { typed[inp.dataset.score] = inp.value; });

  el.innerHTML = `<table><tr><th>Игрок</th><th>Очки</th><th>Статус</th><th>Изменить счёт</th></tr>`+
    state.players.map(p=>{
      const inputId = 'sc_' + p.id;
      const value = inputId === focusedId && typed[p.id] !== undefined ? typed[p.id] : p.score;
      return `<tr><td>${esc(p.name)}</td><td><b>${p.score}</b></td><td>${p.connected?'онлайн':'офлайн'}</td>
      <td><input type="number" data-score="${p.id}" id="${inputId}" value="${value}" style="width:90px"> <button data-set="${p.id}" class="secondary">OK</button></td></tr>`;
    }).join('')+`</table>`;
  el.querySelectorAll('button[data-set]').forEach(b=>b.onclick=()=>{
    const val = document.getElementById('sc_'+b.dataset.set).value;
    emit('admin:setScore',{playerId:b.dataset.set, score:Number(val)});
  });
  if(focusedId){
    const input = document.getElementById(focusedId);
    if(input){ input.focus(); const len = input.value.length; try { input.setSelectionRange(len, len); } catch (e) {} }
  }
}

let lastHoverSent = '';

function boardSig(r){
  // Rebuild only when the board structure really changes. `used` and the
  // special `type` are view dependent and are updated in place: including
  // them in the signature rebuilt the whole board on every server message,
  // which destroyed cells between mousedown and mouseup and swallowed clicks.
  return r.name + '|' + r.categories.map(c=>c.name+':'+c.questions.map(q=>q.value).join(',')).join('||') + '::' + (state ? state.phase : '');
}

function paintCell(cell, q, ci, qi){
  const selected = board.selected && board.selected.ci===ci && board.selected.qi===qi;
  const hovered = board.hovered && board.hovered.ci===ci && board.hovered.qi===qi;
  const cls = ['cell','q', q.used?'used':'', q.type==='cat'?'special-cat':'', q.type==='auction'?'special-auction':'', selected?'selected':'', hovered?'hovered':''].filter(Boolean).join(' ');
  if(cell.className !== cls) cell.className = cls;
  const text = q.used ? '' : String(q.value);
  if(cell.textContent !== text) cell.textContent = text;
  cell.setAttribute('aria-label', q.used ? 'Сыграно' : ('Вопрос за ' + q.value));
  cell.setAttribute('aria-disabled', q.used ? 'true' : 'false');
  if(q.used){
    cell.tabIndex = -1;
    cell.onclick = null; cell.onkeydown = null; cell.onmouseenter = null;
    return;
  }
  cell.tabIndex = 0;
  cell.onclick = () => emit('admin:showQuestion',{ci:Number(ci), qi:Number(qi)}, (res)=>{ if(!res.ok && res.error) alert(res.error); });
  cell.onkeydown = (e) => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); cell.onclick(); } };
  cell.onmouseenter = () => {
    if(!board || board.current) return;
    const key = ci + ':' + qi;
    if(lastHoverSent === key) return;
    lastHoverSent = key;
    emit('admin:hoverQuestion',{ci:Number(ci), qi:Number(qi)});
  };
}

function renderHover(){
  const el = document.getElementById('board');
  if(!el) return;
  el.querySelectorAll('.cell.q').forEach(cell=>{
    const hovered = !!(board && board.hovered && board.hovered.ci===Number(cell.dataset.ci) && board.hovered.qi===Number(cell.dataset.qi));
    cell.classList.toggle('hovered', hovered && !cell.classList.contains('used'));
  });
}

function renderBoard(){
  const el = document.getElementById('board');
  el.style.display = 'block';
  if(!board || !board.round){ el.innerHTML = '<div class="muted">Табло появится в раунде 1/2/3</div>'; el.dataset.sig=''; return; }
  const r = board.round;
  const sig = boardSig(r);
  const canBuild = el.dataset.sig !== sig || !el.querySelector('.board');
  if(canBuild){
    let html = `<h3>${esc(r.name)}</h3><div class="board">`;
    r.categories.forEach((c,ci)=>{
      html += `<div class="cell cat">${esc(c.name)}</div>`;
      c.questions.forEach((q,qi)=>{
        html += `<div class="cell q" data-ci="${ci}" data-qi="${qi}" role="button" tabindex="0"></div>`;
      });
    });
    html += '</div>';
    if(gameCfg.showSpecialMarkersToAdmin !== false) {
      html += `<div class="muted">Жёлтая рамка — «Кот в мешке», красная — «Аукцион»</div>`;
    }
    el.innerHTML = html;
    el.dataset.sig = sig;
    lastHoverSent = '';
    const boardGrid = el.querySelector('.board');
    if(boardGrid){ boardGrid.onmouseleave = ()=>{ lastHoverSent = ''; emit('admin:hoverQuestion',{ci:null, qi:null}); }; }
  }
  // update cells in place, never replacing the nodes themselves
  r.categories.forEach((c,ci)=>{
    c.questions.forEach((q,qi)=>{
      const cell = el.querySelector(`.cell.q[data-ci="${ci}"][data-qi="${qi}"]`);
      if(cell) paintCell(cell, q, ci, qi);
    });
  });
}

function renderCurrent(){
  const card = document.getElementById('currentCard');
  const box = document.getElementById('currentBox');
  const special = document.getElementById('specialControls');
  if(!board || !board.current || !board.current.question){ card.style.display='none'; box.innerHTML=''; special.innerHTML=''; return; }
  card.style.display='block';
  const q = board.current.question;
  const buzz = board.buzz || {};
  const revealed = board.current.revealed !== false;
  const catName = (board.round && board.round.categories && board.current.ci != null && board.round.categories[board.current.ci]) ? board.round.categories[board.current.ci].name : '';
  const donorTheme = (q.type==='cat' && board.current.stage !== 'cat_reveal' && q.theme) ? q.theme : '';
  const shownTheme = donorTheme || catName;
  const previews = (q.images && (q.images.question || q.images.answer))
    ? `<div class="admin-media-grid">
        ${mediaPreview(q.images.question, 'Картинка вопроса')}
        ${mediaPreview(q.images.answer, 'Картинка ответа')}
      </div>`
    : '';
  let extra = `<div class="muted">Тема: <b>${esc(shownTheme || '')}</b>${q.type==='cat' ? '' : ` · Цена: <b>${q.value}</b>`}</div>`;
  if(q.type==='cat'){
    extra += `<div class="muted">Кот в мешке${donorTheme ? ' · Тема кота: '+esc(donorTheme) : ''} · Номинал: ${q.value}</div>`;
    const cb = board.current.catBet;
    if(cb){
      const stakeText = cb.stake != null ? cb.stake : (cb.min === cb.max ? cb.min : `${cb.min} или ${cb.max}`);
      const stage = board.current.stage;
      const asked = cb.stake != null || stage === 'cat_bet' || revealed;
      extra += asked
        ? `<div class="big">Ставка: <b>${stakeText}</b>${cb.stake != null ? '' : ' (выбирает игрок)'}</div>`
        : `<div class="big muted">Ставка: ещё не спрошена</div>`;
      if(cb.note) extra += `<div class="muted">${esc(cb.note)}</div>`;
    }
  }
  if(q.type==='auction') extra += `<div class="muted">Аукцион · Мин. ставка: ${q.value}</div>`;
  if(board.current.auction) extra += `<div>Аукцион: <b>${esc(playerName(board.current.auction.playerId))}</b>, ставка <b>${board.current.auction.stake}</b></div>`;
  if(board.current.catTargetId) extra += `<div>Кот передан: <b>${esc(playerName(board.current.catTargetId))}</b></div>`;

  let main = '';
  if(!revealed && (q.type==='cat' || q.type==='auction')){
    main = `<div class="huge" style="margin:8px 0; color:#ffd166">${q.type==='cat' ? 'КОТ В МЕШКЕ' : 'АУКЦИОН'}</div>
            <div class="muted">Вопрос скрыт до подтверждения показа.</div>`;
  } else {
    main = `<div class="big" style="margin:8px 0">${esc(q.text)}</div>`;
  }

  box.innerHTML = `<div class="question-box">${main}${extra}${previews}
    ${(revealed || q.type==='normal') ? `<div class="answer"><b>Ответ:</b> ${esc(q.answer)}</div>` : `<div class="muted" style="margin-top:8px">Ответ (для админа): ${esc(q.answer)}</div>`}
    <div style="margin-top:8px">Buzz: ${buzz.open?'<span style="color:#22c55e">открыт</span>':'закрыт'} ${buzz.winnerName?`· Первый: <b>${esc(buzz.winnerName)}</b>`:''}</div>
  </div>`;
  renderSpecialControls();

  const boardBtn = document.getElementById('toggleBoard');
  if(boardBtn) boardBtn.textContent = board.boardVisible ? 'Скрыть табло на ТВ' : 'Показать табло на ТВ';
}

function renderSpecialControls(){
  const el = document.getElementById('specialControls');
  if(!board || !board.current || !state) { el.innerHTML=''; return; }
  const q = board.current.question;
  const revealed = board.current.revealed !== false;
  let html = '';
  if(q.type==='cat' && board.current.stage==='cat_reveal'){
    html += `<div class="row"><span>Передать «Кота» игроку:</span><select id="catTarget">${state.players.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <button id="catGive">Передать и назначить отвечающим</button></div>`;
  }
  if(q.type==='auction' && board.current.stage==='auction'){
    html += `<div class="row"><span>Аукцион — игрок:</span><select id="aucPlayer">${state.players.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.score})</option>`).join('')}</select>
      <input id="aucStake" type="number" value="${q.value}" style="width:120px" placeholder="Ставка" /> <button id="aucSet">Назначить</button></div>`;
  }
  const catBet = board.current.catBet;
  const catNeedsStake = q.type==='cat' && !revealed && !!board.current.catTargetId && !(catBet && catBet.stake != null);
  const catStage = board.current.stage;
  if(q.type==='cat' && !revealed && board.current.catTargetId && catStage==='cat_theme'){
    // Тема уже объявлена; следующий шаг — спросить у игрока сумму.
    html += `<div class="row" style="margin-top:8px"><button id="catAskStake" class="warn">Спросить ставку у игрока</button>
      <span class="muted">На ТВ появятся две возможные ставки раунда.</span></div>`;
  }
  if(q.type==='cat' && !revealed && board.current.catTargetId && catBet && catStage==='cat_bet'){
    // Ставка игрока — только минимум или максимум раунда: две кнопки вместо поля ввода.
    const options = catBet.min === catBet.max ? [catBet.min] : [catBet.min, catBet.max];
    html += `<div class="row" style="margin-top:8px"><span>Ставка, которую озвучил игрок:</span>
      ${options.map(value=>`<button class="cat-stake ${catBet.stake === value ? 'warn' : 'secondary'}" data-cat-stake="${value}">${value}</button>`).join('')}
      <span class="muted">${catBet.stake != null ? `выбрано: <b>${catBet.stake}</b>` : 'две возможные ставки раунда'}</span></div>
      ${catBet.note ? `<div class="muted" style="margin-top:4px">${esc(catBet.note)}</div>` : ''}`;
  }
  const canReveal = q.type==='cat'
    ? (!revealed && catStage==='cat_bet')
    : (q.type==='auction' && !revealed && catStage==='open');
  if(canReveal){
    html += `<div class="row" style="margin-top:8px"><button id="revealQuestion" class="warn" ${catNeedsStake ? 'disabled' : ''}>Показать вопрос (на ТВ)</button>
      <span class="muted">${catNeedsStake ? 'Сначала выберите ставку игрока.' : 'Нажмите после того, как условия/ответственный подтверждены.'}</span></div>`;
  }
  el.innerHTML = html;
  const cg = document.getElementById('catGive');
  if(cg) cg.onclick = ()=>emit('admin:setCatTarget',{playerId:document.getElementById('catTarget').value, openBuzz:false});
  const cas = document.getElementById('catAskStake');
  if(cas) cas.onclick = ()=>emit('admin:catAskStake', {}, (res)=>{ if(res && !res.ok) alert(res.error); });
  const as = document.getElementById('aucSet');
  if(as) as.onclick = ()=>emit('admin:setAuction',{playerId:document.getElementById('aucPlayer').value, stake:Number(document.getElementById('aucStake').value)});
  el.querySelectorAll('button[data-cat-stake]').forEach(b=>{
    b.onclick = ()=>emit('admin:setCatStake', { stake: Number(b.dataset.catStake) }, (res)=>{ if(res && !res.ok) alert(res.error); });
  });
  const rq = document.getElementById('revealQuestion');
  if(rq) rq.onclick = ()=>emit('admin:revealQuestion', {}, (res)=>{ if(res && !res.ok) alert(res.error); });
}

function renderFinal(){
  const card = document.getElementById('finalCard');
  const box = document.getElementById('finalAdmin');
  const themesEl = document.getElementById('finalThemes');
  const hint = document.getElementById('finalHint');
  const revealBtn = document.getElementById('revealFinal');
  const resetBtn = document.getElementById('resetFinalThemes');
  if(!state || !board || state.phase!=='final') { card.style.display='none'; return; }
  card.style.display='block';
  const f = board.final || {};
  const themes = f.themes || [];
  const remaining = f.remaining || 0;
  const revealed = !!f.revealed;
  const canRemove = !revealed && remaining > 1;

  themesEl.innerHTML = themes.map((t, i) => {
    const cls = ['theme-chip', t.removed ? 'removed' : '', t.selected ? 'selected' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-remove-theme="${i}" ${(t.removed || !canRemove) ? 'disabled' : ''}>${esc(t.theme)}${t.removed ? ' ✓' : ''}</button>`;
  }).join('') || '<div class="muted">В паке нет финальных тем</div>';
  themesEl.querySelectorAll('button[data-remove-theme]').forEach(b=>{
    b.onclick = ()=>emit('admin:removeFinalTheme', { index: Number(b.dataset.removeTheme) }, (res)=>{
      if(res && !res.ok && res.error) alert(res.error);
    });
  });

  if(hint){
    hint.textContent = revealed
      ? 'Вопрос финала уже показан на ТВ — темы менять нельзя.'
      : remaining > 1
        ? `Осталось тем: ${remaining}. Нажмите на тему, чтобы убрать её.`
        : remaining === 1
          ? 'Осталась одна тема — теперь игроки делают ставки, затем можно показать вопрос.'
          : 'Тем не осталось — верните темы кнопкой ниже.';
  }
  if(revealBtn) revealBtn.disabled = revealed || remaining !== 1;
  if(resetBtn) resetBtn.disabled = revealed;

  const eligible = (state.players||[]).filter(p=>p.score>0 || (f.bets && f.bets[p.id] != null));
  const previews = (f.images && (f.images.question || f.images.answer))
    ? `<div class="admin-media-grid">
        ${mediaPreview(f.images.question, 'Картинка вопроса')}
        ${mediaPreview(f.images.answer, 'Картинка ответа')}
      </div>`
    : '';
  const answerBtn = `<button id="finalRevealAnswer" class="secondary" ${f.revealed ? '' : 'disabled'}>${f.answerVisible ? 'Скрыть ответ (на ТВ)' : 'Показать ответ (на ТВ)'}</button>`;
  box.innerHTML = `<div class="muted">Тема: <b>${esc(f.theme||'ещё не выбрана')}</b></div>
    <div class="muted">Вопрос показан на ТВ: ${f.revealed?'да':'нет'}</div>
    ${f.answer ? `<div class="answer"><b>Правильный ответ (финал):</b> ${esc(f.answer)}</div>` : ''}
    ${previews}
    <div class="row" style="margin-top:10px">${answerBtn}</div>
    <h3>Ставки/ответы/зачёт</h3>
    <table><tr><th>Игрок</th><th>Счёт</th><th>Ставка</th><th>Ответ</th><th>Итог</th><th>Судейство</th></tr>
    ${eligible.map(p=>{
      const bet = f.bets ? f.bets[p.id] : '';
      const ans = f.answers ? f.answers[p.id] : '';
      const judged = f.results ? f.results[p.id] : undefined;
      return `<tr><td>${esc(p.name)}</td><td>${p.score}</td><td>${bet ?? ''}</td><td>${esc(ans||'')}</td>
      <td>${judged === true ? '✅ верно' : judged === false ? '❌ неверно' : '—'}</td>
      <td><button class="good" data-fj="${p.id}" data-c="1">Верно</button> <button class="bad" data-fj="${p.id}" data-c="0">Неверно</button></td></tr>`;
    }).join('')}</table>`;
  box.querySelectorAll('button[data-fj]').forEach(b=>b.onclick=()=>emit('admin:finalJudge',{playerId:b.dataset.fj, correct:b.dataset.c==='1'}));
  const finalAnswerBtn = document.getElementById('finalRevealAnswer');
  if(finalAnswerBtn) finalAnswerBtn.onclick = ()=>emit('admin:finalRevealAnswer', { show: !(f.answerVisible) }, (res)=>{
    if(res && !res.ok && res.error) alert(res.error);
  });
}

document.getElementById('resetFinalThemes').onclick = ()=>emit('admin:resetFinalThemes', {}, (res)=>{
  if(res && !res.ok && res.error) alert(res.error);
});

document.getElementById('buzzOpen').onclick = ()=>emit('admin:buzzControl',{action:'open'});
document.getElementById('buzzReset').onclick = ()=>emit('admin:buzzControl',{action:'reset'});
document.getElementById('buzzClose').onclick = ()=>emit('admin:buzzControl',{action:'close'});
document.getElementById('toggleAnswer').onclick = ()=>emit('admin:revealAnswer',{show: !(board && board.current && board.current.answerVisible)});
document.getElementById('toggleBoard').onclick = ()=>emit('admin:setBoardVisible',{ visible: !(board && board.boardVisible) });
document.getElementById('judgeCorrect').onclick = ()=>judge(true);
document.getElementById('judgeWrong').onclick = ()=>judge(false);
document.getElementById('closeQuestion').onclick = ()=>emit('admin:closeQuestion', {}, (res)=>{ if(res && res.error) alert(res.error); });
document.getElementById('revealFinal').onclick = ()=>emit('admin:finalReveal');

function judge(correct){
  const cd = document.getElementById('customDelta').value;
  let delta = cd === '' ? undefined : Number(cd);
  if(board && board.current && board.current.auction && delta===undefined) delta = board.current.auction.stake;
  if(board && board.current && board.current.question && board.current.question.type==='cat' && delta===undefined){
    const cb = board.current.catBet;
    delta = cb && cb.stake != null ? cb.stake : board.current.question.value;
  }
  const pid = board && board.buzz ? board.buzz.winnerId : null;
  if(!pid && !(board && board.current && board.current.auction) && !(board && board.current && board.current.catTargetId)){
    // allow but server will reject if missing
  }
  emit('admin:judge',{correct, playerId: pid, delta}, (res)=>{ if(res && res.error) alert(res.error); });
}
function playerName(id){ if(!state) return id; const p=state.players.find(x=>x.id===id); return p?p.name:id; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

/* -------- Итоги игры: победители (максимальный счёт) -------- */
function renderFinishAdmin(){
  const card = document.getElementById('finishCard');
  const box = document.getElementById('finishAdmin');
  if(!card || !box) return;
  if(!state || state.phase !== 'finished'){ card.style.display='none'; box.innerHTML=''; return; }
  card.style.display='block';

  const players = state.players || [];
  const sorted = [...players].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
  const max = sorted.length ? (Number(sorted[0].score)||0) : 0;
  const winners = sorted.filter(p=>(Number(p.score)||0) === max);

  const head = winners.length
    ? `<div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:26px">🥇</span>
        ${winners.map(w=>`<span><b style="font-size:20px">${esc(w.name)}</b> <span class="muted">${Number(w.score)||0} очков</span></span>`).join('<span class="muted">·</span>')}
      </div>
      ${winners.length > 1 ? '<div class="muted">Ничья: у нескольких игроков одинаковый лучший счёт.</div>' : ''}`
    : '<div class="muted">В игре не было игроков.</div>';

  box.innerHTML = `${head}
    <h3 style="margin-top:14px">Итоговая таблица</h3>
    <table><tr><th>Место</th><th>Игрок</th><th>Счёт</th></tr>
    ${sorted.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}${(Number(p.score)||0) === max ? ' 🥇' : ''}</td><td>${Number(p.score)||0}</td></tr>`).join('')}
    </table>`;
}

function renderAll(){ renderPhase(); renderPlayers(); renderBoard(); renderCurrent(); renderFinal(); renderFinishAdmin(); }
refresh();
