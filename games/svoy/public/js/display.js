const socket = io();
let lanJoinUrl = null;
fetch('/api/net')
  .then((res) => res.json())
  .then((info) => {
    if (info && info.ip) lanJoinUrl = `http://${info.ip}:${info.port || location.port}/`;
    if (state) renderQR();
  })
  .catch(() => {});
const params = new URLSearchParams(location.search);
const roomId = params.get('room') || sessionStorage.getItem('si_room');
if (params.get('room') && roomId) sessionStorage.setItem('si_room', roomId);
const roomInfo = document.getElementById('roomInfo');
let state=null, board=null;
let lastCurrentSig = null;

function mediaHtml(img, className){
  if(!img || !img.src) return '';
  return `<figure class="${className}"><img src="${esc(img.src)}" alt="${esc(img.alt||'')}" loading="eager" decoding="async" onerror="this.closest('figure').classList.add('media-broken');this.remove();"></figure>`;
}

function join(){
  if(!roomId){ roomInfo.textContent='Нет комнаты. Откройте экран из панели администратора (ссылка должна содержать комнату).'; return; }
  socket.emit('display:join',{roomId},(res)=>{ if(!res.ok) roomInfo.textContent = res.error||'Ошибка'; });
}
socket.on('connect', join);
socket.on('room:state', s=>{ state=s; render(); });
socket.on('board:state', b=>{ board=b; render(); });
socket.on('game:config', cfg=>{ if(window.Sfx) Sfx.configure(cfg && cfg.sound); });
socket.on('sfx', ({ name } = {})=>{ if(window.Sfx) Sfx.play(name); });
// hover is cosmetic: update the highlight without re-rendering the whole board
socket.on('board:hover', h=>{ if(!board) return; board.hovered = (h && h.hovered) || null; renderHover(); });

function render(){
  if(state){
    document.getElementById('title').textContent = 'Своя игра — ' + state.name;
    roomInfo.textContent = [state.packTitle, phaseName(state.phase)].filter(Boolean).join(' · ');
  }
  document.getElementById('phaseInfo').textContent = state? `Фаза: ${phaseName(state.phase)}` : '';
  renderQR();
  renderBoard(); renderCurrent(); renderFinal(); renderFinish(); renderPlayers();
}

function renderQR(){
  const el = document.getElementById('qrLobby');
  if(!el) return;
  const show = !!(state && state.phase === 'lobby');
  if(show){
    const joinUrl = lanJoinUrl || `${location.origin}/`;
    const img = document.getElementById('qrImg');
    const urlEl = document.getElementById('qrUrl');
    if(img && img.dataset.url !== joinUrl){ img.src = `/qr?text=${encodeURIComponent(joinUrl)}`; img.dataset.url = joinUrl; }
    if(urlEl) urlEl.textContent = joinUrl;
    clearTimeout(el._hideT);
    el.style.display = 'flex';
    el.classList.remove('tv-hidden');
    el.classList.add('tv-visible');
  } else {
    el.classList.remove('tv-visible');
    el.classList.add('tv-hidden');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(()=>{ if(el.classList.contains('tv-hidden')) el.style.display='none'; }, 380);
  }
}
function phaseName(p){ return ({lobby:'Лобби',round1:'1 раунд',round2:'2 раунд',round3:'3 раунд','round1_done':'1 раунд завершён','round2_done':'2 раунд завершён','round3_done':'3 раунд завершён',final:'Финал',finished:'Игра завершена'}[p]||p); }

function renderBoard(){
  const el = document.getElementById('board');
  if(state && (state.phase === 'lobby' || state.phase === 'final' || state.phase === 'finished')){
    clearTimeout(el._hideT);
    el.classList.remove('tv-visible');
    el.classList.add('tv-hidden');
    el.style.display = 'none';
    el.innerHTML = '';
    el.dataset.sig='';
    return;
  }
  const showBoard = !!(board && (board.boardVisible || !(board.current && board.current.question)));
  if(!board || !board.round){
    clearTimeout(el._hideT);
    el.style.display = '';
    el.classList.remove('tv-hidden'); el.classList.add('tv-visible');
    el.innerHTML = '<div class="muted big">Ожидание начала раунда…</div>';
    el.dataset.sig='';
    return;
  }
  const r = board.round;
  // structure only: used markers are updated in place, so they must not trigger a rebuild
  const sig = r.categories.map(c=>c.name+'|'+c.questions.map(q=>q.value).join(',')).join('||') + '::' + (state ? state.phase : '');
  if(showBoard){
    clearTimeout(el._hideT);
    const canBuild = el.dataset.sig !== sig || !el.querySelector('.board');
    if(canBuild){
      let html = `<div class="board">`;
      r.categories.forEach((c,ci)=>{
        html += `<div class="cell cat">${esc(c.name)}</div>`;
        c.questions.forEach((q,qi)=>{
          html += `<div class="cell q" data-ci="${ci}" data-qi="${qi}"></div>`;
        });
      });
      html += '</div>'; el.innerHTML = html; el.dataset.sig = sig;
    }
    r.categories.forEach((c,ci)=>{
      c.questions.forEach((q,qi)=>{
        const cell = el.querySelector(`.cell.q[data-ci="${ci}"][data-qi="${qi}"]`);
        if(!cell) return;
        const selected = board.selected && board.selected.ci===q.ci && board.selected.qi===q.qi;
        const hovered = board.hovered && board.hovered.ci===q.ci && board.hovered.qi===q.qi;
        const marker = q.type==='cat' ? 'special-cat' : q.type==='auction' ? 'special-auction' : '';
        const cls = ['cell','q', q.used?'used':'', marker, selected?'selected':'', hovered?'hovered':''].filter(Boolean).join(' ');
        if(cell.className !== cls) cell.className = cls;
        const text = q.used ? '' : String(q.value);
        if(cell.textContent !== text) cell.textContent = text;
      });
    });
    el.style.display = '';
    el.classList.remove('tv-hidden'); el.classList.add('tv-visible');
  } else {
    el.classList.remove('tv-visible'); el.classList.add('tv-hidden');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(()=>{ if(el.classList.contains('tv-hidden')) el.style.display='none'; }, 380);
  }
}

function renderHover(){
  const el = document.getElementById('board');
  if(!el) return;
  el.querySelectorAll('.cell.q').forEach(cell=>{
    const hovered = !!(board && board.hovered && board.hovered.ci===Number(cell.dataset.ci) && board.hovered.qi===Number(cell.dataset.qi));
    cell.classList.toggle('hovered', hovered && !cell.classList.contains('used'));
  });
}

function renderCurrent(){
  const el = document.getElementById('current');
  if(!board || !board.current || !board.current.question || board.boardVisible){
    lastCurrentSig = null;
    el.classList.remove('tv-visible'); el.classList.add('tv-hidden');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(()=>{ if(el.classList.contains('tv-hidden')) { el.style.display='none'; el.innerHTML=''; } }, 380);
    return;
  }
  clearTimeout(el._hideT);
  const q = board.current.question; const buzz = board.buzz||{};
  const cellTheme = (board.round && board.round.categories && board.current.ci != null && board.round.categories[board.current.ci]) ? board.round.categories[board.current.ci].name : '';
  // у кота тема меняется вместе с вопросом: после передачи показываем тему донора
  const donorTheme = (q.type === 'cat' && board.current.stage !== 'cat_reveal' && q.theme) ? q.theme : '';
  const catName = donorTheme || cellTheme || q.theme || '';
  const revealed = board.current.revealed !== false;
  let head = `<div class="big">Тема: <b>${esc(catName || '—')}</b>${q.type==='cat' ? '' : ` · Цена: <b>${q.value}</b>`}</div>`;
  if(q.type==='cat') head += `<div class="muted big">КОТ В МЕШКЕ · номинал ${q.value}</div>`;
  if(q.type==='auction') head += `<div class="muted big">АУКЦИОН · номинал ${q.value}</div>`;
  if(q.type==='cat' && board.current.catTargetId && board.current.catBet){
    const cb = board.current.catBet;
    const stakeChoices = cb.min === cb.max ? `${cb.min}` : `${cb.min} или ${cb.max}`;
    // Порядок: тема → вопрос о ставке → две суммы → показ вопроса.
    if(cb.stake != null){
      head += `<div class="big">Ставка игрока: <b style="color:#ffd166">${cb.stake}</b></div>`;
    } else if(board.current.stage === 'cat_bet'){
      head += `<div class="big">Возможные ставки: <b style="color:#ffd166">${stakeChoices}</b></div>${cb.note ? `<div class="muted big">${esc(cb.note)}</div>` : ''}`;
    } else {
      head += `<div class="big muted">Ведущий спрашивает ставку…</div>`;
    }
  }
  if(board.current.auction) head += `<div class="big">Играет: <b>${esc(playerName(board.current.auction.playerId))}</b>, ставка ${board.current.auction.stake}</div>`;
  if(board.current.catTargetId && q.type==='cat') head += `<div class="big">Отвечает: <b>${esc(playerName(board.current.catTargetId))}</b></div>`;

  const showAnswer = !!(revealed && board.current.answerVisible);
  const visibleImage = showAnswer
    ? ((q.images && q.images.answer) || (q.images && q.images.question))
    : (q.images && q.images.question);
  const questionMedia = mediaHtml(visibleImage, 'qa-media');

  let body = '';
  if(!revealed && (q.type==='cat' || q.type==='auction')){
    body = `<div class="huge" style="margin:18px 0; color:#ffd166">${q.type==='cat' ? 'КОТ В МЕШКЕ' : 'АУКЦИОН'}</div>
            <div class="big muted">Ожидание подтверждения администратора…</div>`;
  } else {
    const textHtml = showAnswer
      ? `<div class="qa-text qa-text-answered">
          <div class="qa-answer-text"><b class="qa-answer-label">Ответ:</b> ${esc(q.answer || '')}</div>
          <div class="qa-question-text">${esc(q.text || '')}</div>
        </div>`
      : (q.text ? `<div class="qa-text huge">${esc(q.text)}</div>` : '');

    body = `<div class="qa-body ${questionMedia ? 'has-media' : 'no-media'}">
            ${textHtml}
            ${questionMedia}
          </div>`;
  }

  const html = `${head}${body}
    ${(buzz.winnerName && q.type==='normal')? `<div class="big" style="color:#22c55e">Первым нажал: ${esc(buzz.winnerName)}</div>`:''}`;
  const sig = JSON.stringify([state ? state.phase : null, board.current.ci, board.current.qi, q.type, q.images || null, board.current.stage, board.current.revealed, board.current.answerVisible, board.current.auction, board.current.catBet, board.current.catTargetId, buzz.winnerId, buzz.winnerName, buzz.open]);
  if(sig === lastCurrentSig && el.classList.contains('tv-visible')){
    return;
  }
  const prev = lastCurrentSig ? JSON.parse(lastCurrentSig) : null;
  const isNew = !prev || prev[1] !== board.current.ci || prev[2] !== board.current.qi || prev[5] !== board.current.stage || prev[0] !== (state ? state.phase : null);
  lastCurrentSig = sig;
  el.innerHTML = html;
  el.style.display='';
  if(isNew){
    el.classList.remove('tv-visible'); el.classList.add('tv-hidden');
    requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ el.classList.remove('tv-hidden'); el.classList.add('tv-visible'); }); });
  } else {
    el.classList.remove('tv-hidden'); el.classList.add('tv-visible');
  }
}

let finalViewSig = null;
function renderFinal(){
  const el = document.getElementById('finalBox');
  if(!board || !board.final){
    finalViewSig = null;
    el.classList.remove('tv-visible'); el.classList.add('tv-hidden');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(()=>{ if(el.classList.contains('tv-hidden')) { el.style.display='none'; el.innerHTML=''; } }, 380);
    return;
  }
  clearTimeout(el._hideT);
  const f = board.final;
  const themes = f.themes || [];
  const remaining = f.remaining || 0;

  if(remaining > 1){
    // rebuild once, then remove themes in place so the animation is visible
    const gridSig = 'grid|' + themes.map(t=>t.theme).join('|');
    if(finalViewSig !== gridSig){
      finalViewSig = gridSig;
      el.innerHTML = `<div class="final-screen">
        <div class="final-title">ФИНАЛ · ВЫБОР ТЕМЫ</div>
        <div class="final-subtitle">Ведущий убирает темы, пока не останется одна</div>
        <div class="final-themes">${themes.map((t,i)=>`<div class="final-theme" data-i="${i}">${esc(t.theme)}</div>`).join('')}</div>
      </div>`;
    }
    themes.forEach((t,i)=>{
      const node = el.querySelector(`.final-theme[data-i="${i}"]`);
      if(node) node.classList.toggle('removed', !!t.removed);
    });
  } else if(remaining === 1){
    const showAnswer = !!f.answerVisible;
    const visibleImage = showAnswer
      ? ((f.images && f.images.answer) || (f.images && f.images.question))
      : (f.images && f.images.question);
    const questionMedia = mediaHtml(visibleImage, 'qa-media final-media');
    const textHtml = showAnswer
      ? `<div class="final-text qa-text-answered">
          <div class="qa-answer-text"><b class="qa-answer-label">Ответ:</b> ${esc(f.answer || '')}</div>
          <div class="qa-question-text">${esc(f.text || '')}</div>
        </div>`
      : (f.text ? `<div class="final-text huge">${esc(f.text)}</div>` : '');
    const html = `<div class="final-screen final-question">
      <div class="final-title">ФИНАЛ</div>
      <div class="final-theme-name">${esc(f.theme||'')}</div>
      ${f.revealed
        ? `<div class="qa-body ${questionMedia ? 'has-media' : 'no-media'}">
            ${textHtml}
            ${questionMedia}
          </div>`
        : `<div class="final-wait">Игроки делают ставки…</div>`}
    </div>`;
    if(finalViewSig !== html){ finalViewSig = html; el.innerHTML = html; }
  } else {
    const html = `<div class="final-screen"><div class="final-title">ФИНАЛ</div><div class="final-wait">Ожидание выбора темы…</div></div>`;
    if(finalViewSig !== html){ finalViewSig = html; el.innerHTML = html; }
  }
  el.style.display='';
  el.classList.remove('tv-hidden'); el.classList.add('tv-visible');
}

/* -------- Итоги игры: победители (максимальный счёт) и салют -------- */

// Все игроки с максимальным счётом: при ничьей победителей несколько.
function finishWinners(){
  const players = (state && state.players) || [];
  if(!players.length) return [];
  const scores = players.map(p=>Number(p.score) || 0);
  const max = Math.max(...scores);
  return players.filter(p=>(Number(p.score) || 0) === max);
}

let finishViewSig = null;

function renderFinish(){
  const el = document.getElementById('finishBox');
  if(!el) return;

  if(!state || state.phase !== 'finished'){
    // ушли с экрана итогов — убираем оверлей и останавливаем салют
    finishViewSig = null;
    if(window.Fireworks) Fireworks.stop();
    el.classList.remove('tv-visible'); el.classList.add('tv-hidden');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(()=>{ if(el.classList.contains('tv-hidden')) { el.style.display='none'; el.innerHTML=''; } }, 380);
    return;
  }

  clearTimeout(el._hideT);
  const winners = finishWinners();
  const bestScore = winners.length ? (Number(winners[0].score) || 0) : 0;
  const html = `<div class="finish-screen">
    <div class="finish-title">ИГРА ЗАВЕРШЕНА</div>
    ${winners.length
      ? `<div class="finish-subtitle">${winners.length > 1 ? 'Победители · максимальный счёт' : 'Победитель'}</div>
        <div class="finish-winners">${winners.map(w=>`<div class="finish-winner">
          <div class="finish-medal">🥇</div>
          <div class="finish-name">${esc(w.name)}</div>
          <div class="finish-score">${Number(w.score) || 0}</div>
        </div>`).join('')}</div>
        <div class="finish-note">${winners.length > 1 ? `Ничья: у ${winners.length} игроков лучший счёт ${bestScore}` : `Лучший счёт: ${bestScore}`}</div>`
      : `<div class="finish-subtitle">В игре не было игроков</div>`}
  </div>`;
  if(finishViewSig !== html){ finishViewSig = html; el.innerHTML = html; }
  el.style.display='';
  el.classList.remove('tv-hidden'); el.classList.add('tv-visible');
  // салют запускается один раз: повторные вызовы start() игнорируются
  if(window.Fireworks) Fireworks.start();
}

let lastPlayersSig = '';
function renderPlayers(){
  const el = document.getElementById('players');
  if(!state) { lastPlayersSig=''; el.innerHTML=''; return; }
  const winner = board && board.buzz ? board.buzz.winnerId : null;
  const sig = JSON.stringify([(state.players||[]).map(p=>[p.id,p.name,p.score]), winner]);
  if(sig === lastPlayersSig) return;
  lastPlayersSig = sig;
  el.innerHTML = (state.players||[]).map(p=>`<div class="pchip ${p.id===winner?'win':''}"><span>${esc(p.name)}</span><span class="score">${p.score} очков</span></div>`).join('') || '<div class="muted">Нет игроков</div>';
}
function playerName(id){ if(!state) return id; const p=(state.players||[]).find(x=>x.id===id); return p?p.name:id; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
render();
