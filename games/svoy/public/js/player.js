const socket = io();
const roomId = sessionStorage.getItem('si_room');
let playerId = sessionStorage.getItem('si_player');
let playerToken = sessionStorage.getItem('si_player_token') || '';
let playerNameStored = localStorage.getItem('si_name') || sessionStorage.getItem('si_name') || '';
let state=null, board=null;

function join(){
  if(!roomId){ document.getElementById('status').textContent='Нет комнаты. Вернитесь на главную.'; return; }
  socket.emit('player:join',{roomId, name: playerNameStored, playerId, playerToken}, (res)=>{
    if(!res.ok){ document.getElementById('status').textContent = res.error||'Ошибка входа'; return; }
    playerId = res.playerId;
    playerToken = res.playerToken || '';
    sessionStorage.setItem('si_player', playerId);
    sessionStorage.setItem('si_player_token', playerToken);
    if(playerNameStored) localStorage.setItem('si_name', playerNameStored);
  });
}
socket.on('connect', join);
socket.on('room:state', s=>{ state=s; render(); });
socket.on('board:state', b=>{ board=b; render(); });

const buzzBtn = document.getElementById('buzz');
buzzBtn.onclick = ()=>{ socket.emit('player:buzz',{roomId},()=>{}); };

function me(){ return state && (state.players||[]).find(p=>p.id===playerId); }

function playerNameById(id){ if(!state) return ''; const p=(state.players||[]).find(x=>x.id===id); return p?p.name:''; }

// Все игроки с максимальным счётом (при ничьей победителей несколько).
function finishWinners(){
  const players = (state && state.players) || [];
  if(!players.length) return [];
  const max = Math.max(...players.map(p=>Number(p.score) || 0));
  return players.filter(p=>(Number(p.score) || 0) === max);
}

function render(){
  const m = me();
  document.getElementById('me').innerHTML = m ? `<div class="big">${esc(m.name)}</div><div>Ваш счёт: <b class="huge" style="color:#ffd166">${m.score}</b></div>` : 'Подключение...';
  const buzz = board && board.buzz;
  const current = board && board.current;
  const q = current && current.question;
  const locked = buzz && buzz.locked && buzz.locked.includes && buzz.locked.includes(playerId);
  let enabled = !!(buzz && buzz.open && !buzz.winnerId && !locked && current);
  if(current && (current.stage==='cat_reveal' || current.stage==='auction')) enabled = false;
  if(q && (q.type==='cat' || q.type==='auction')) enabled = false;
  buzzBtn.disabled = !enabled;

  let status = 'Ожидание вопроса...';
  if(state && state.phase === 'finished'){
    const winners = finishWinners();
    const best = winners.length ? (Number(winners[0].score) || 0) : 0;
    if(!winners.length){
      status = '<div class="big">Игра завершена</div><div class="muted">В игре не было игроков.</div>';
    } else {
      const isWinner = winners.some(w=>w.id===playerId);
      status = `<div class="big" style="color:#ffd166">Игра завершена!</div>
        <div class="big">${winners.length > 1 ? 'Победители' : 'Победитель'}: <b>${winners.map(w=>esc(w.name)).join(', ')}</b> · ${best}</div>
        ${isWinner
          ? '<div style="color:#22c55e"><b>Поздравляем с победой! 🎉</b></div>'
          : (m ? `<div>Ваш итоговый счёт: <b>${Number(m.score) || 0}</b></div>` : '')}`;
    }
  } else if(current && q){
    if(q.type === 'cat'){
      if(current.stage === 'cat_reveal'){
        status = `<div class="big" style="color:#ffd166">Кот в мешке!</div><div>Ведущий выбирает, кому передать вопрос. Ожидайте.</div>`;
      } else {
        const targetId = current.catTargetId || (buzz && buzz.winnerId);
        const targetName = playerNameById(targetId) || (buzz && buzz.winnerName) || 'игрок';
        const cb = current.catBet || null;
        const choices = cb ? (cb.min === cb.max ? `<b>${cb.min}</b>` : `<b>${cb.min}</b> или <b>${cb.max}</b>`) : '';
        const themeLine = q.theme ? `<div>Тема: <b>${esc(q.theme)}</b></div>` : '';
        const waitText = current.revealed === false
          ? 'Дождитесь, пока ведущий покажет вопрос на экране.'
          : 'Вопрос на экране — отвечайте вслух.';
        if(targetId === playerId){
          // шаги: тема → ставка → показ вопроса
          let step;
          if(cb && cb.stake != null) step = `<div>Ставка: <b>${cb.stake}</b></div>`;
          else if(current.stage === 'cat_bet') step = `<div>Назовите ставку вслух: ${choices}. Ведущий выберет её в панели.</div>`;
          else step = '<div>Ведущий объявил тему и сейчас спросит вашу ставку. Приготовьтесь.</div>';
          status = `<div class="big" style="color:#22c55e">Вам достался «Кот в мешке»!</div>
            ${themeLine}
            ${step}
            <div>Отвечаете вы один. ${waitText}</div>
            <div class="muted" style="margin-top:6px">Кнопку нажимать не нужно, ведущий сам засчитает ответ.</div>`;
        } else {
          const stakeLine = cb && cb.stake != null ? `<div>Ставка: <b>${cb.stake}</b></div>` : '';
          status = `<div class="big" style="color:#ffd166">Кот в мешке</div><div>Вопрос передан игроку: <b>${esc(targetName)}</b>.</div>${themeLine}${stakeLine}<div class="muted">Отвечает он один, остальные ждут.</div>`;
        }
      }
    } else if(q.type === 'auction'){
      if(current.stage === 'auction'){
        status = `<div class="big" style="color:#ffd166">Аукцион!</div><div>Ведущий определяет игрока и ставку. Ожидайте.</div>`;
      } else {
        const bidderId = (current.auction && current.auction.playerId) || (buzz && buzz.winnerId);
        const bidderName = playerNameById(bidderId) || (buzz && buzz.winnerName) || 'игрок';
        const stake = current.auction ? current.auction.stake : (q.value);
        if(bidderId === playerId){
          status = `<div class="big" style="color:#22c55e">Вы играете аукцион!</div>
            <div>Ваша ставка: <b>${stake}</b>. Отвечаете вы один. ${current.revealed === false ? 'Дождитесь, пока ведущий покажет вопрос.' : 'Вопрос на экране — отвечайте вслух.'}</div>
            <div class="muted" style="margin-top:6px">Кнопку нажимать не нужно, ведущий сам засчитает ответ.</div>`;
        } else {
          status = `<div class="big" style="color:#ffd166">Аукцион</div><div>Играет <b>${esc(bidderName)}</b> со ставкой <b>${stake}</b>. Отвечает он один, остальные ждут.</div>`;
        }
      }
    } else {
      if(buzz && buzz.winnerId === playerId) status = '<div class="big" style="color:#22c55e">Вы нажали первым! Отвечайте вслух.</div>';
      else if(buzz && buzz.winnerName) status = `Первым нажал: <b>${esc(buzz.winnerName)}</b>`;
      else if(buzz && buzz.open) status = 'Вопрос на экране. Жмите кнопку, чтобы ответить первым!';
      else status = 'Вопрос на экране. Ждите сигнала ведущего.';
    }
  }
  document.getElementById('status').innerHTML = status;

  renderPlayers();
  renderFinal();
}

let lastPlayersSig = '';
function renderPlayers(){
  const el = document.getElementById('players');
  if(!state){ lastPlayersSig=''; el.innerHTML=''; return; }
  const winner = board && board.buzz ? board.buzz.winnerId : null;
  const sig = JSON.stringify([(state.players||[]).map(p=>[p.id,p.name,p.score]), winner, playerId]);
  if(sig === lastPlayersSig) return;
  lastPlayersSig = sig;
  el.innerHTML = (state.players||[]).map(p=>`<div class="pchip ${p.id===winner?'win':''}" style="${p.id===playerId?'border-color:#3b82f6':''}"><span>${esc(p.name)}</span><span class="score">${p.score}</span></div>`).join('');
}

let finalUiSig = null;
function renderFinal(){
  const el = document.getElementById('finalPlayer');
  const m = me();
  if(!state || state.phase!=='final' || !m){
    if(el.style.display !== 'none'){ el.style.display='none'; el.innerHTML=''; }
    finalUiSig = null;
    return;
  }
  el.style.display='block';
  if(m.score <= 0){
    if(finalUiSig !== 'ineligible'){
      finalUiSig = 'ineligible';
      el.innerHTML = '<div class="muted">У вас 0 или меньше очков — участие в финале недоступно.</div>';
    }
    return;
  }
  const f = board && board.final;
  if(!f){
    if(finalUiSig !== 'waiting'){ finalUiSig = 'waiting'; el.innerHTML = '<div class="muted">Ожидание финала…</div>'; }
    return;
  }
  const myBet = f.bets ? f.bets[m.id] : null;
  const themes = f.themes || [];
  const remaining = f.remaining || 0;
  const sig = [m.id, m.score, !!f.revealed, remaining, f.selectedIndex].join('|');
  if(sig === finalUiSig){
    const label = document.getElementById('myBetLabel');
    if(label) label.textContent = myBet != null ? myBet : 'не указана';
    return;
  }
  finalUiSig = sig;

  let html = `<h3>Финал</h3>`;
  if(remaining > 1){
    html += `<div class="muted">Ведущий убирает темы. Осталось: <b>${remaining}</b></div>
      <div class="theme-grid">${themes.map(t=>`<div class="theme-chip ${t.removed?'removed':''} ${t.selected?'selected':''}">${esc(t.theme)}</div>`).join('')}</div>
      <div class="muted" style="margin-top:8px">Ставки откроются, когда останется одна тема.</div>`;
  } else if(remaining === 1){
    html += `<div class="muted">Тема: <b>${esc(f.theme||'')}</b></div>`;
    html += `<div style="margin-top:8px;font-size:22px">Ваша ставка: <b id="myBetLabel">${myBet != null ? myBet : 'не указана'}</b></div>`;
    if(!f.revealed){
      html += `<div class="row" style="margin-top:10px"><input id="finalBet" type="number" min="1" max="${m.score}" value="${myBet != null ? myBet : ''}" placeholder="Ваша ставка (1..${m.score})" style="font-size:28px;padding:14px 16px;min-width:220px" /> <button id="sendBet" class="secondary" style="font-size:24px;padding:14px 20px">Отправить ставку</button></div>`;
      html += `<div class="muted" style="margin-top:6px">Ставку можно изменить до показа вопроса.</div>`;
    } else {
      html += `<div class="muted" style="margin-top:8px">Ставка зафиксирована (вопрос уже показан).</div>`;
      html += `<div class="row" style="margin-top:10px"><input id="finalAns" placeholder="Ваш ответ (для ведущего)" style="flex:1;font-size:24px;padding:14px 16px" /> <button id="sendAns" class="secondary" style="font-size:22px;padding:14px 20px">Отправить ответ</button></div>`;
    }
  } else {
    html += `<div class="muted">Ожидание выбора темы…</div>`;
  }
  el.innerHTML = html;
  const sb = document.getElementById('sendBet');
  if(sb) sb.onclick = ()=>socket.emit('player:finalBet',{roomId, bet:Number(document.getElementById('finalBet').value)},(res)=>{ if(res && !res.ok) alert(res.error||'Ошибка'); });
  const sa = document.getElementById('sendAns');
  if(sa) sa.onclick = ()=>socket.emit('player:finalAnswer',{roomId, answer:document.getElementById('finalAns').value},(res)=>{ if(res && !res.ok) alert(res.error||'Ошибка'); });
}

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
render();
