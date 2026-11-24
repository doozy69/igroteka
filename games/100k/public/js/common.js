/**
 * Общий WebSocket-клиент и утилиты.
 */
export function connectWS(onMessage) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const queue = [];

  ws.addEventListener('open', () => {
    while (queue.length) ws.send(queue.shift());
  });

  ws.addEventListener('message', (e) => {
    try { onMessage(JSON.parse(e.data)); } catch (err) { console.error('WS message error', err); }
  });

  ws.addEventListener('close', () => {
    // Простое восстановление: перезагружаем страницу, сессия сохранится.
    setTimeout(() => location.reload(), 1200);
  });

  return {
    ws,
    send(type, payload = {}) {
      const data = JSON.stringify({ type, payload });
      if (ws.readyState === 1) ws.send(data);
      else if (ws.readyState === 0) queue.push(data);
    }
  };
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function phaseName(p) {
  return ({
    lobby: 'Лобби',
    faceoff: 'Розыгрыш',
    play: 'Игра',
    steal: 'Блиц-опрос',
    intro: 'Раунд завершён',
    reverse: 'Игра наоборот',
    big: 'Большая игра',
    finished: 'Игра завершена'
  }[p] || p || '—');
}

export function typeName(t) {
  return ({
    simple: 'Простая',
    double: 'Двойная',
    triple: 'Тройная',
    reverse: 'Игра наоборот',
    big: 'Большая игра'
  }[t] || t || '—');
}

export function teamName(state, id) {
  const t = state && state.teams ? state.teams.find((x) => x.id === id) : null;
  return t ? t.name : id;
}

/** Таблица итогов: все завершённые блоки и результаты большой игры. */
export function summaryHtml(state) {
  const history = state.history || [];
  const blocks = history.map((h, index) => {
    const answers = h.answers || [];
    const choiceText = (idx) => (idx >= 0 && answers[idx] ? answers[idx].text : 'мимо');
    const reverseInfo = h.reverse
      ? `<div class="summary-reverse">
          <span>${esc(teamName(state, 'team1'))}: <b>${esc(choiceText(h.reverse.choices?.team1))}</b> (+${h.reverse.p1 ?? 0})</span>
          <span>${esc(teamName(state, 'team2'))}: <b>${esc(choiceText(h.reverse.choices?.team2))}</b> (+${h.reverse.p2 ?? 0})</span>
        </div>`
      : '';
    return `<div class="summary-block">
      <div class="summary-block-head">
        <div>
          <div class="summary-block-kicker">Блок ${index + 1} · ${esc(typeName(h.type))}</div>
          <div class="summary-block-q">${esc(h.text || '—')}</div>
        </div>
        <div class="summary-block-scores">
          ${(h.scores || []).map((t) => `<span>${esc(t.name)}: <b>${t.score}</b></span>`).join('')}
        </div>
      </div>
      ${reverseInfo}
      <table class="summary-table">
        <thead><tr><th>#</th><th>Ответ</th><th>Очки</th><th>На табло</th></tr></thead>
        <tbody>
          ${answers.map((a, i) => `<tr class="${a.revealed ? '' : 'unrevealed'}">
            <td>${i + 1}</td>
            <td>${esc(a.text)}</td>
            <td>${a.points ?? ''}</td>
            <td>${a.revealed ? 'открыт' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  });

  const b = state.big;
  let bigBlock = '';
  if (b && b.stage === 'done') {
    const questions = state.round?.bigQuestions || [];
    const p1 = state.players?.find((p) => p.id === b.player1Id);
    const p2 = state.players?.find((p) => p.id === b.player2Id);
    const teamLabel = (p) => (p ? teamName(state, p.teamId) : '');
    const resultText = b.result === 'win'
      ? `Цель достигнута: ${b.total} из ${state.settings?.bigGameTarget || 200}`
      : b.result === 'lose'
        ? `Цель не достигнута: ${b.total} из ${state.settings?.bigGameTarget || 200}`
        : `Итог: ${b.total || 0} из ${state.settings?.bigGameTarget || 200}`;
    const rows = questions.map((q) => {
      const i = q.i;
      const dup = !!(b.duplicates2 && b.duplicates2[i]);
      const possible = (q.answers || []).map((a) => `<span class="big-possible-item">${esc(a.text)} <b>${a.points}</b></span>`).join('');
      return `<tr class="${dup ? 'big-duplicate' : ''}">
        <td>${i + 1}. ${esc(q.text)}</td>
        <td class="big-possible">${possible}</td>
        <td>${esc(b.answers1?.[i] || '')}</td>
        <td>${b.points1?.[i] ?? ''}</td>
        <td>${esc(b.answers2?.[i] || '')}</td>
        <td>${b.points2?.[i] ?? ''}${dup ? ' <span class="dup-mark">повтор</span>' : ''}</td>
      </tr>`;
    }).join('');
    bigBlock = `<div class="summary-block summary-big">
      <div class="summary-block-head">
        <div>
          <div class="summary-block-kicker">Большая игра</div>
          <div class="summary-block-q">${esc(b.player1 || 'Игрок 1')}${teamLabel(p1) ? ` (${esc(teamLabel(p1))})` : ''} и ${esc(b.player2 || 'Игрок 2')}${teamLabel(p2) ? ` (${esc(teamLabel(p2))})` : ''}</div>
        </div>
        <div class="summary-big-result ${b.result || ''}">${esc(resultText)}</div>
      </div>
      <table class="summary-table">
        <thead><tr><th>Вопрос</th><th>Возможные ответы и очки</th><th>${esc(b.player1 || 'Игрок 1')}</th><th>Очки</th><th>${esc(b.player2 || 'Игрок 2')}</th><th>Очки</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  if (!blocks.length && !bigBlock) return '<p class="muted">Нет данных для итогов.</p>';
  return `<div class="summary-grid">${blocks.join('')}${bigBlock}</div>`;
}
