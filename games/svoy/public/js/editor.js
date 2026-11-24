(() => {
  const DEFAULT_VALUES = {
    round1: [100, 200, 300, 400, 500],
    round2: [200, 400, 600, 800, 1000],
    round3: [300, 600, 900, 1200, 1500]
  };
  const DEFAULT_ROUND_NAMES = {
    round1: 'Первый раунд',
    round2: 'Второй раунд',
    round3: 'Третий раунд'
  };

  const state = {
    token: sessionStorage.getItem('si_editor_token') || '',
    packs: [],
    file: null,
    pack: null,
    activeRound: 'round1',
    dirty: false,
    busy: false
  };

  const $ = (selector) => document.querySelector(selector);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function setPath(object, path, value) {
    const parts = path.split('.');
    let current = object;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (current[key] == null || typeof current[key] !== 'object') {
        current[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[key];
    }
    current[parts[parts.length - 1]] = value;
  }

  function getPath(object, path) {
    return path.split('.').reduce((value, key) => (
      value == null ? undefined : value[key]
    ), object);
  }

  function normalizeUrl(src) {
    const value = String(src || '').trim();
    if (!value) return '';
    if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return '/' + value;
  }

  function isExternalImageRef(value) {
    const src = String(value || '').trim();
    return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)
      || /^(?:data|file|javascript|blob):/i.test(src);
  }

  function normalizeImageValue(value) {
    if (!value) return { src: '', alt: '' };
    if (typeof value === 'string') {
      return { src: isExternalImageRef(value) ? '' : value, alt: '' };
    }
    const src = String(value.src || '');
    return { src: isExternalImageRef(src) ? '' : src, alt: String(value.alt || '') };
  }

  function createBlankPack() {
    const pack = {
      title: 'Новый пак',
      round1: { name: DEFAULT_ROUND_NAMES.round1, categories: [] },
      round2: { name: DEFAULT_ROUND_NAMES.round2, categories: [] },
      round3: { name: DEFAULT_ROUND_NAMES.round3, categories: [] },
      final: { themes: [] }
    };

    for (const roundKey of ['round1', 'round2', 'round3']) {
      for (let ci = 0; ci < 6; ci++) {
        const questions = [];
        for (let qi = 0; qi < 5; qi++) {
          questions.push({ value: DEFAULT_VALUES[roundKey][qi], text: '', answer: '' });
        }
        pack[roundKey].categories.push({ name: '', questions });
      }
    }

    for (let i = 0; i < 7; i++) {
      pack.final.themes.push({ theme: '', text: '', answer: '' });
    }

    return pack;
  }

  function normalizePackForEditor(pack) {
    const out = JSON.parse(JSON.stringify(pack || {}));
    out.title = out.title || 'Новый пак';

    for (const roundKey of ['round1', 'round2', 'round3']) {
      out[roundKey] = out[roundKey] || {};
      out[roundKey].name = out[roundKey].name || DEFAULT_ROUND_NAMES[roundKey];
      out[roundKey].categories = Array.isArray(out[roundKey].categories) ? out[roundKey].categories : [];
      out[roundKey].categories = out[roundKey].categories.map((category) => (
        category && typeof category === 'object' && !Array.isArray(category) ? category : {}
      ));

      while (out[roundKey].categories.length < 6) {
        out[roundKey].categories.push({ name: '', questions: [] });
      }
      out[roundKey].categories = out[roundKey].categories.slice(0, 6);

      out[roundKey].categories.forEach((category) => {
        category.name = category.name || '';
        category.questions = Array.isArray(category.questions) ? category.questions : [];
        category.questions = category.questions.map((question) => (
          question && typeof question === 'object' && !Array.isArray(question) ? question : {}
        ));

        while (category.questions.length < 5) {
          category.questions.push({
            value: DEFAULT_VALUES[roundKey][category.questions.length],
            text: '',
            answer: ''
          });
        }
        category.questions = category.questions.slice(0, 5);

        category.questions.forEach((question, qi) => {
          question.value = question.value != null ? question.value : DEFAULT_VALUES[roundKey][qi];
          question.text = question.text || '';
          question.answer = question.answer || '';
          question.images = {
            question: normalizeImageValue(question.images && question.images.question),
            answer: normalizeImageValue(question.images && question.images.answer),
            original: normalizeImageValue(question.images && question.images.original)
          };
        });
      });
    }

    out.final = out.final || {};
    if (!Array.isArray(out.final.themes)) {
      out.final.themes = out.final.theme
        ? [{
            theme: out.final.theme,
            text: out.final.text,
            answer: out.final.answer,
            images: out.final.images
          }]
        : [];
    }
    delete out.final.theme;
    delete out.final.text;
    delete out.final.answer;
    delete out.final.images;

    out.final.themes = out.final.themes.map((theme) => (
      theme && typeof theme === 'object' && !Array.isArray(theme) ? theme : {}
    ));
    if (!out.final.themes.length) {
      out.final.themes.push({ theme: '', text: '', answer: '' });
    }
    out.final.themes = out.final.themes.slice(0, 7);

    out.final.themes.forEach((theme) => {
      theme.theme = theme.theme || '';
      theme.text = theme.text || '';
      theme.answer = theme.answer || '';
      theme.images = {
        question: normalizeImageValue(theme.images && theme.images.question),
        answer: normalizeImageValue(theme.images && theme.images.answer),
        original: normalizeImageValue(theme.images && theme.images.original)
      };
    });

    return out;
  }

  function cleanImages(images) {
    if (!images) return null;
    const question = images.question && String(images.question.src || '').trim();
    const answer = images.answer && String(images.answer.src || '').trim();
    const original = images.original && String(images.original.src || '').trim();
    if (!question && !answer) return null;

    const result = {};
    if (question) {
      result.question = {
        src: question,
        alt: String(images.question.alt || '').trim()
      };
    }
    if (answer) {
      result.answer = {
        src: answer,
        alt: String(images.answer.alt || '').trim()
      };
    }
    if (original) {
      result.original = {
        src: original,
        alt: String(images.original.alt || '').trim()
      };
    }
    return result;
  }

  function cleanPackForSave(pack) {
    const out = JSON.parse(JSON.stringify(pack));
    out.title = String(out.title || '').trim() || 'Без названия';

    for (const roundKey of ['round1', 'round2', 'round3']) {
      out[roundKey].name = String(out[roundKey].name || '').trim() || DEFAULT_ROUND_NAMES[roundKey];

      out[roundKey].categories.forEach((category) => {
        category.name = String(category.name || '').trim();

        category.questions.forEach((question, qi) => {
          question.value = Number(question.value) || DEFAULT_VALUES[roundKey][qi];
          question.text = String(question.text || '').trim();
          question.answer = String(question.answer || '').trim();
          question.images = cleanImages(question.images);
          if (!question.images) delete question.images;
        });
      });
    }

    out.final.themes.forEach((theme) => {
      theme.theme = String(theme.theme || '').trim();
      theme.text = String(theme.text || '').trim();
      theme.answer = String(theme.answer || '').trim();
      theme.images = cleanImages(theme.images);
      if (!theme.images) delete theme.images;
    });

    return out;
  }

  function validateImages(images, label) {
    if (!images) return null;
    const question = images.question && String(images.question.src || '').trim();
    const answer = images.answer && String(images.answer.src || '').trim();
    const original = images.original && String(images.original.src || '').trim();
    if (!question && !answer) return null;

    const items = [];
    if (question) items.push(['вопроса', question]);
    if (answer) items.push(['ответа', answer]);
    if (original) items.push(['оригинала', original]);

    for (const [kind, src] of items) {
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || /^(?:data|file|javascript|blob):/i.test(src)) {
        return `${label}: внешние ссылки в картинке ${kind} не поддерживаются.`;
      }
      if (!/^\/?images\//.test(src)) {
        return `${label}: путь картинки ${kind} должен начинаться с images/.`;
      }
      if (!/\.(png|jpe?g|webp|avif)$/i.test(src)) {
        return `${label}: неверное расширение картинки ${kind}.`;
      }
    }
    return null;
  }

  function validateClient(pack) {
    const errors = [];

    for (const roundKey of ['round1', 'round2', 'round3']) {
      const round = pack[roundKey];
      if (!round || !Array.isArray(round.categories) || round.categories.length !== 6) {
        errors.push(`${roundKey}: нужно 6 категорий.`);
        continue;
      }

      round.categories.forEach((category, ci) => {
        if (!category.name) errors.push(`${roundKey}, категория ${ci + 1}: нет названия.`);
        if (!Array.isArray(category.questions) || category.questions.length !== 5) {
          errors.push(`${roundKey}, категория ${ci + 1}: нужно 5 вопросов.`);
          return;
        }

        category.questions.forEach((question, qi) => {
          const label = `${roundKey}, ${ci + 1}-${qi + 1}`;
          if (!question.text) errors.push(`${label}: пустой вопрос.`);
          if (!question.answer) errors.push(`${label}: пустой ответ.`);
          if (!Number.isFinite(Number(question.value))) errors.push(`${label}: номинал должен быть числом.`);
          const imageError = validateImages(question.images, label);
          if (imageError) errors.push(imageError);
        });
      });
    }

    const themes = pack.final && pack.final.themes;
    if (!Array.isArray(themes) || themes.length < 1) {
      errors.push('Финал: нужна хотя бы одна тема.');
    } else {
      if (themes.length > 7) errors.push('Финал: не больше 7 тем.');
      themes.forEach((theme, index) => {
        const label = `Финал, тема ${index + 1}`;
        if (!theme.theme) errors.push(`${label}: нет названия.`);
        if (!theme.text) errors.push(`${label}: пустой вопрос.`);
        if (!theme.answer) errors.push(`${label}: пустой ответ.`);
        const imageError = validateImages(theme.images, label);
        if (imageError) errors.push(imageError);
      });
    }

    return errors;
  }

  function setStatus(text, kind) {
    const el = $('#saveStatus');
    el.textContent = text || '';
    el.className = 'muted' + (kind === 'ok' ? ' status-ok' : kind === 'error' ? ' status-error' : '');
  }

  function markDirty() {
    state.dirty = true;
    setStatus('Есть несохранённые изменения');
  }

  function setBusy(busy) {
    state.busy = busy;
    $('#savePack').disabled = busy;
    $('#newPack').disabled = busy;
    $('#downloadPack').disabled = busy;
    $('#cleanupImages').disabled = busy;
  }

  function showTokenCard(message) {
    $('#editorStatus').textContent = 'Требуется токен редактора';
    $('#tokenCard').style.display = 'block';
    $('#packCard').style.display = 'none';
    $('#editorTabs').style.display = 'none';
    $('#editorRoot').innerHTML = '';
    $('#tokenError').textContent = message || '';
    setTimeout(() => {
      const input = $('#editorToken');
      if (input) input.focus();
    }, 50);
  }

  async function api(url, options = {}) {
    const headers = { 'X-Editor-Request': '1', ...(options.headers || {}) };
    if (state.token) headers['X-Editor-Token'] = encodeURIComponent(state.token);

    const body = options.body;
    if (body && !(body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (e) {
      throw new Error('Не удалось связаться с сервером редактора. Проверьте, что сервер запущен, и повторите вход.');
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
    }

    if (response.status === 401) {
      showTokenCard((data && data.error) || 'Требуется токен редактора');
    }

    if (!response.ok) {
      const error = new Error((data && data.error) || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data || { ok: true };
  }

  function findSlot(slot) {
    return Array.from(document.querySelectorAll('.image-slot'))
      .find((element) => element.dataset.slot === slot) || null;
  }

  function updateImagePreview(slotElement, src) {
    const preview = slotElement.querySelector('.image-preview');
    if (!preview) return;
    preview.classList.remove('image-missing');

    const value = String(src || '').trim();
    const editButton = slotElement.querySelector('[data-edit-image]');
    if (editButton) editButton.disabled = !value;
    const originalAnswerButton = slotElement.querySelector('[data-original-answer]');
    if (originalAnswerButton) originalAnswerButton.disabled = !value;
    const answerToQuestionButton = slotElement.querySelector('[data-answer-to-question]');
    if (answerToQuestionButton) answerToQuestionButton.disabled = !value;
    const removeButton = slotElement.querySelector('[data-remove-image]');
    if (removeButton) removeButton.disabled = !value;

    if (!value) {
      preview.innerHTML = '<span class="image-placeholder">Нет картинки</span>';
      return;
    }

    preview.innerHTML = `<img src="${esc(normalizeUrl(value))}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('image-missing');">`;
  }

  function imageSlotHtml(basePath, slot, kind, image) {
    const src = (image && image.src) || '';
    const alt = (image && image.alt) || '';
    const preview = src
      ? `<img src="${esc(normalizeUrl(src))}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('image-missing');">`
      : '<span class="image-placeholder">Нет картинки</span>';
    const editButton = kind === 'question'
      ? `<button type="button" class="secondary" data-edit-image="${slot}" ${src ? '' : 'disabled'}>✎ Изменить</button>`
      : '';
    const originalAnswerButton = kind === 'question'
      ? `<button type="button" class="secondary" data-original-answer="${slot}" ${src ? '' : 'disabled'} title="Подставить чистую картинку в ответ">Оригинал в ответ</button>`
      : '';
    const answerToQuestionButton = kind === 'answer'
      ? `<button type="button" class="secondary" data-answer-to-question="${slot}" ${src ? '' : 'disabled'} title="Перенести картинку ответа в вопрос">В вопрос</button>`
      : '';
    const removeButton = `<button type="button" class="secondary" data-remove-image="${slot}" ${src ? '' : 'disabled'}>Удалить</button>`;

    return `<div class="image-slot" data-slot="${slot}" data-path-base="${basePath}">
      <div class="image-slot-head">
        <span>${kind === 'question' ? 'Картинка-загадка' : 'Картинка-отгадка'}</span>
        <button type="button" class="secondary" data-upload="${slot}">Загрузить</button>
        ${editButton}
        ${originalAnswerButton}
        ${answerToQuestionButton}
        ${removeButton}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden data-upload-input="${slot}" />
      </div>
      <div class="image-preview">${preview}</div>
      <input class="image-path" data-path="${basePath}.src" value="${esc(src)}" placeholder="images/questions/..." />
      <input class="image-alt" data-path="${basePath}.alt" value="${esc(alt)}" placeholder="Alt-текст (необязательно)" />
    </div>`;
  }

  function roundSlot(roundKey) {
    return roundKey === 'round1' ? 'r1' : roundKey === 'round2' ? 'r2' : 'r3';
  }

  function renderQuestionCard(roundKey, ci, qi, question) {
    const base = `${roundKey}.categories.${ci}.questions.${qi}`;

    return `<div class="question-card">
      <div class="question-main">
        <label class="editor-field q-value"><span>Номинал</span>
          <input type="number" data-path="${base}.value" value="${esc(question.value)}" />
        </label>
        <label class="editor-field q-text"><span>Вопрос</span>
          <textarea rows="2" data-path="${base}.text">${esc(question.text)}</textarea>
        </label>
        <label class="editor-field q-answer"><span>Ответ</span>
          <input data-path="${base}.answer" value="${esc(question.answer)}" />
        </label>
      </div>
      <div class="question-images">
        ${imageSlotHtml(`${base}.images.question`, `${roundSlot(roundKey)}-c${ci + 1}-q${qi + 1}-question`, 'question', question.images.question)}
        ${imageSlotHtml(`${base}.images.answer`, `${roundSlot(roundKey)}-c${ci + 1}-q${qi + 1}-answer`, 'answer', question.images.answer)}
      </div>
    </div>`;
  }

  function renderRound(roundKey) {
    const root = $('#editorRoot');
    if (!state.pack) {
      root.innerHTML = '';
      return;
    }

    if (roundKey === 'final') {
      root.innerHTML = renderFinalView();
      return;
    }

    const round = state.pack[roundKey];
    let html = `<section class="card round-panel">
      <div class="round-head">
        <label class="editor-field editor-field-grow"><span>Название раунда</span>
          <input data-path="${roundKey}.name" value="${esc(round.name || '')}" />
        </label>
        <div class="muted">6 категорий × 5 вопросов</div>
      </div>
      <div class="category-list">`;

    round.categories.forEach((category, ci) => {
      html += `<details class="category-card" open>
        <summary class="category-summary">
          <span class="category-index">${ci + 1}</span>
          <span class="category-title">${esc(category.name || 'Без названия')}</span>
          <span class="muted">${category.name ? '' : 'категория без названия'}</span>
        </summary>
        <div class="category-body">
          <label class="editor-field"><span>Название категории</span>
            <input data-path="${roundKey}.categories.${ci}.name" value="${esc(category.name || '')}" />
          </label>
          <div class="question-list">`;

      category.questions.forEach((question, qi) => {
        html += renderQuestionCard(roundKey, ci, qi, question);
      });

      html += '</div></div></details>';
    });

    html += '</div></section>';
    root.innerHTML = html;
  }

  function renderFinalView() {
    const themes = state.pack.final.themes || [];
    let html = `<section class="card round-panel">
      <div class="round-head">
        <div>
          <h2>Финал</h2>
          <div class="muted">7 тем: тема, вопрос, ответ и две картинки</div>
        </div>
      </div>
      <div class="final-editor-grid">`;

    themes.forEach((theme, index) => {
      const images = theme.images || {
        question: { src: '', alt: '' },
        answer: { src: '', alt: '' }
      };
      html += `<div class="final-editor-card">
        <div class="final-card-head">
          <span class="category-index">${index + 1}</span>
          <span>Тема финала</span>
          ${themes.length > 1 ? `<button type="button" class="bad final-remove-btn" data-remove-final="${index}">Удалить</button>` : ''}
        </div>
        <label class="editor-field"><span>Тема</span>
          <input data-path="final.themes.${index}.theme" value="${esc(theme.theme || '')}" />
        </label>
        <label class="editor-field"><span>Вопрос</span>
          <textarea rows="2" data-path="final.themes.${index}.text">${esc(theme.text || '')}</textarea>
        </label>
        <label class="editor-field"><span>Ответ</span>
          <input data-path="final.themes.${index}.answer" value="${esc(theme.answer || '')}" />
        </label>
        <div class="question-images">
          ${imageSlotHtml(`final.themes.${index}.images.question`, `final-t${index + 1}-question`, 'question', images.question)}
          ${imageSlotHtml(`final.themes.${index}.images.answer`, `final-t${index + 1}-answer`, 'answer', images.answer)}
        </div>
      </div>`;
    });

    html += `</div>
      <div class="row" style="margin-top:12px">
        <button type="button" id="addFinalTheme" class="secondary" ${themes.length >= 7 ? 'disabled' : ''}>Добавить тему</button>
        <span class="muted">Тем: ${themes.length} из 7</span>
      </div>
    </section>`;
    return html;
  }

  function renderTabs() {
    const tabs = [
      ['round1', 'Раунд 1'],
      ['round2', 'Раунд 2'],
      ['round3', 'Раунд 3'],
      ['final', 'Финал']
    ];

    $('#editorTabs').innerHTML = tabs.map(([key, label]) =>
      `<button type="button" class="editor-tab ${state.activeRound === key ? 'active' : ''}" data-tab="${key}">${label}</button>`
    ).join('');
  }

  async function loadPacks(selectFile) {
    const data = await api('/api/editor/packs');
    state.packs = data.packs || [];

    const select = $('#packSelect');
    select.innerHTML = state.packs.map((pack) =>
      `<option value="${esc(pack.file)}">${esc(pack.title)} — ${esc(pack.file)}</option>`
    ).join('');

    $('#packCard').style.display = 'block';
    $('#tokenCard').style.display = 'none';
    $('#tokenError').textContent = '';

    const available = state.packs.map((pack) => pack.file);
    const file = selectFile && available.includes(selectFile)
      ? selectFile
      : state.file && available.includes(state.file)
        ? state.file
        : (state.packs[0] && state.packs[0].file);
    if (!file) {
      $('#editorTabs').style.display = 'none';
      $('#editorRoot').innerHTML = '<div class="card muted">В папке questions/ пока нет паков. Создайте новый пак.</div>';
      $('#editorStatus').textContent = 'Паков нет';
      $('#savePack').disabled = true;
      $('#downloadPack').disabled = true;
      $('#cleanupImages').disabled = true;
      return;
    }

    select.value = file;
    await loadPack(file);
  }

  async function loadPack(file) {
    const data = await api(`/api/editor/pack/${encodeURIComponent(file)}`);
    state.file = data.file;
    state.pack = normalizePackForEditor(data.pack);
    state.activeRound = state.activeRound || 'round1';
    state.dirty = false;

    $('#packTitle').value = state.pack.title || '';
    $('#packMeta').textContent = state.file;
    $('#editorTabs').style.display = 'flex';
    $('#editorStatus').textContent = `Загружен пак: ${state.file}`;
    $('#savePack').disabled = false;
    $('#downloadPack').disabled = false;
    $('#cleanupImages').disabled = false;
    setStatus('');

    renderTabs();
    renderRound(state.activeRound);
  }

  async function refreshPackOptions() {
    try {
      const data = await api('/api/editor/packs');
      state.packs = data.packs || [];
      const select = $('#packSelect');
      const current = state.file;
      select.innerHTML = state.packs.map((pack) =>
        `<option value="${esc(pack.file)}">${esc(pack.title)} — ${esc(pack.file)}</option>`
      ).join('');
      if (current) select.value = current;
    } catch (e) {
      // Не критично: список обновится при следующей загрузке.
    }
  }

  async function savePack() {
    if (!state.pack || !state.file || state.busy) return;

    const clean = cleanPackForSave(state.pack);
    const errors = validateClient(clean);
    if (errors.length) {
      const shown = errors.slice(0, 3).join(' ');
      setStatus(shown + (errors.length > 3 ? ` …ещё ${errors.length - 3}` : ''), 'error');
      return;
    }

    try {
      setBusy(true);
      setStatus('Сохранение…');
      const result = await api(`/api/editor/pack/${encodeURIComponent(state.file)}`, {
        method: 'PUT',
        body: JSON.stringify({ pack: clean })
      });
      state.dirty = false;
      const removedCount = (result.removed || []).length;
      setStatus(
        `Сохранено: ${result.title}${removedCount ? ` · удалено старых файлов: ${removedCount}` : ''}`,
        'ok'
      );
      $('#editorStatus').textContent = `Сохранён пак: ${state.file}`;
      await refreshPackOptions();
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cleanupImages() {
    if (!state.pack || !state.file) return;
    if (!confirm('Удалить картинки, созданные редактором и не указанные в текущем паке?')) return;

    try {
      const clean = cleanPackForSave(state.pack);
      const result = await api(`/api/editor/cleanup-images/${encodeURIComponent(state.file)}`, {
        method: 'POST',
        body: JSON.stringify({ pack: clean })
      });
      const count = (result.removed || []).length;
      setStatus(count ? `Удалено лишних картинок: ${count}` : 'Лишних картинок нет', 'ok');
    } catch (e) {
      setStatus('Ошибка очистки: ' + e.message, 'error');
    }
  }

  async function uploadBlob({ packBase, slot, blob, filename }) {
    const form = new FormData();
    form.append('file', blob, filename || 'image.png');
    form.append('pack', packBase);
    form.append('slot', slot);
    return api('/api/editor/upload', { method: 'POST', body: form });
  }

  async function uploadImage(slot, file) {
    if (!state.pack || !state.file) {
      alert('Сначала выберите или создайте пак.');
      return;
    }

    const slotElement = findSlot(slot);
    if (!slotElement) return;

    const pathInput = slotElement.querySelector('.image-path');
    const packBase = state.file.replace(/\.json$/i, '');

    setStatus(`Загрузка ${file.name}…`);
    const uploadButton = slotElement.querySelector('[data-upload]');
    if (uploadButton) uploadButton.disabled = true;

    try {
      const result = await uploadBlob({
        packBase,
        slot,
        blob: file,
        filename: file.name
      });

      if (pathInput) pathInput.value = result.path;

      const basePath = slotElement.dataset.pathBase;
      if (basePath) setPath(state.pack, `${basePath}.src`, result.path);

      // Новая картинка вопроса — старый оригинал больше не соответствует ей.
      if (slot.endsWith('-question') && basePath) {
        setPath(state.pack, `${basePath.replace(/\.question$/, '')}.original`, { src: '', alt: '' });
      }

      updateImagePreview(slotElement, result.path);
      markDirty();
      setStatus(
        `Картинка загружена (${result.width}×${result.height}, ${Math.round((result.size || 0) / 1024)} КБ). Не забудьте сохранить пак.`,
        'ok'
      );
    } catch (e) {
      setStatus('Ошибка загрузки: ' + e.message, 'error');
    } finally {
      if (uploadButton) uploadButton.disabled = false;
    }
  }

  /* ---------- Мини-paint ---------- */

  let paint = null;

  function paintEl(id) {
    return document.getElementById(id);
  }

  function setPaintStatus(text, kind) {
    const el = paintEl('paintStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'muted' + (kind === 'ok' ? ' status-ok' : kind === 'error' ? ' status-error' : '');
  }

  function readPaintSize() {
    const input = paintEl('paintSize');
    if (!input) return 18;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 500;
    const value = Math.round(Number(input.value) || 18);
    return Math.max(min, Math.min(max, value));
  }

  function paintBrushWidth() {
    const screen = readPaintSize();
    const scale = paint && paint.displayScale ? paint.displayScale : 1;
    return Math.max(1, screen / scale);
  }

  function stepPaintSize(delta) {
    const input = paintEl('paintSize');
    if (!input) return;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 500;
    const next = Math.max(min, Math.min(max, readPaintSize() + delta));
    input.value = String(next);
    if (paint && (paint.tool === 'brush' || paint.tool === 'eraser') && paint.canvas.freeDrawingBrush) {
      paint.canvas.freeDrawingBrush.width = paintBrushWidth();
    }
  }

  function updatePaintToolButtons() {
    if (!paint) return;
    document.querySelectorAll('[data-paint-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.paintTool === paint.tool);
    });
  }

  function updatePaintHistoryButtons() {
    if (!paint) return;
    paintEl('paintUndo').disabled = paint.historyIndex <= 0;
    paintEl('paintRedo').disabled = paint.historyIndex >= paint.history.length - 1;
  }

  function resetPaintOriginalToggle() {
    const checkbox = paintEl('paintShowOriginal');
    if (checkbox) checkbox.checked = false;
    const saveButton = paintEl('paintSave');
    if (saveButton) saveButton.textContent = 'Сохранить вопрос';
  }

  function setPaintOriginal(show) {
    if (!paint) return;
    paint.showOriginal = !!show;
    if (paint.displayEl) {
      paint.displayEl.src = paint.showOriginal ? paint.originalSrc : paint.editedSrc;
    }
    if (paint.canvas.wrapperEl) {
      paint.canvas.wrapperEl.style.visibility = paint.showOriginal ? 'hidden' : 'visible';
    }
    const checkbox = paintEl('paintShowOriginal');
    if (checkbox) checkbox.checked = paint.showOriginal;
    const saveButton = paintEl('paintSave');
    if (saveButton) saveButton.textContent = paint.showOriginal ? 'Сохранить оригинал' : 'Сохранить вопрос';
    if (paint.showOriginal) paint.canvas.isDrawingMode = false;
    else setPaintTool(paint.tool);
    paint.canvas.requestRenderAll();
  }

  function savePaintHistory() {
    if (!paint) return;
    const json = JSON.stringify(paint.canvas.toJSON(['globalCompositeOperation']));
    if (paint.history[paint.historyIndex] === json) return;
    paint.history = paint.history.slice(0, paint.historyIndex + 1);
    paint.history.push(json);
    paint.historyIndex = paint.history.length - 1;
    paint.dirty = true;
    updatePaintHistoryButtons();
  }

  function restorePaintHistory(index) {
    if (!paint || index < 0 || index >= paint.history.length) return;
    paint.historyIndex = index;
    const json = paint.history[index];
    paint.canvas.loadFromJSON(json, () => {
      if (!paint) return;
      setPaintTool(paint.tool);
      setPaintOriginal(paint.showOriginal);
      paint.canvas.requestRenderAll();
      paint.dirty = true;
      updatePaintHistoryButtons();
    });
  }

  function createPaintShape(tool, start, end) {
    const color = paintEl('paintColor').value || '#000000';
    const fillColor = paintEl('paintFill').value || '#ffffff';
    const fill = paintEl('paintFillEnabled').checked ? fillColor : 'transparent';
    const strokeWidth = Math.max(1, paintBrushWidth() / 4);
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (tool === 'rect') {
      return new fabric.Rect({
        left, top, width, height,
        originX: 'left', originY: 'top',
        fill, stroke: color, strokeWidth,
        selectable: false, evented: false, erasable: true
      });
    }
    if (tool === 'ellipse') {
      return new fabric.Ellipse({
        left, top, rx: width / 2, ry: height / 2,
        originX: 'left', originY: 'top',
        fill, stroke: color, strokeWidth,
        selectable: false, evented: false, erasable: true
      });
    }
    if (tool === 'line') {
      return new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: color, strokeWidth,
        selectable: false, evented: false, erasable: true
      });
    }
    return null;
  }

  function updatePaintShape(shape, start, end) {
    if (shape.type === 'line') {
      shape.set({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      shape.setCoords();
      return;
    }

    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (shape.type === 'ellipse') {
      shape.set({ left, top, rx: width / 2, ry: height / 2 });
    } else {
      shape.set({ left, top, width, height });
    }
    shape.setCoords();
  }

  let PaintEraserBrushClass = null;

  function createEraserBrush(canvas) {
    if (!PaintEraserBrushClass) {
      PaintEraserBrushClass = class extends fabric.PencilBrush {
        createPath(pathData) {
          const path = super.createPath(pathData);
          path.set({
            fill: 'rgba(0,0,0,1)',
            stroke: 'rgba(0,0,0,1)',
            globalCompositeOperation: 'destination-out'
          });
          return path;
        }
      };
    }
    return new PaintEraserBrushClass(canvas);
  }

  function setPaintObjectsSelectable(enabled) {
    if (!paint) return;
    paint.canvas.getObjects().forEach((object) => {
      // Следы ластика — это destination-out, их не выделяем.
      if (object.globalCompositeOperation === 'destination-out') {
        object.selectable = false;
        object.evented = false;
        return;
      }
      object.selectable = !!enabled;
      object.evented = !!enabled;
    });
    if (!enabled) paint.canvas.discardActiveObject();
    paint.canvas.requestRenderAll();
  }

  function setPaintTool(tool) {
    if (!paint) return;
    paint.tool = tool;
    const canvas = paint.canvas;

    if (tool === 'select') {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      setPaintObjectsSelectable(true);
    } else if (tool === 'brush') {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      setPaintObjectsSelectable(false);
      const brush = new fabric.PencilBrush(canvas);
      brush.color = paintEl('paintColor').value || '#000000';
      brush.width = paintBrushWidth();
      canvas.freeDrawingBrush = brush;
    } else if (tool === 'eraser') {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      setPaintObjectsSelectable(false);
      const brush = createEraserBrush(canvas);
      brush.width = paintBrushWidth();
      canvas.freeDrawingBrush = brush;
    } else {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      canvas.defaultCursor = 'crosshair';
      setPaintObjectsSelectable(false);
    }

    updatePaintToolButtons();
  }

  function fitPaintCanvas() {
    if (!paint) return;
    const wrap = document.querySelector('.paint-canvas-wrap');
    if (!wrap) return;
    const maxW = Math.max(200, wrap.clientWidth - 24);
    const maxH = Math.max(150, wrap.clientHeight - 24);
    const scale = Math.min(maxW / paint.naturalW, maxH / paint.naturalH, 1);
    paint.displayScale = scale;
    const displayW = Math.max(100, Math.round(paint.naturalW * scale));
    const displayH = Math.max(100, Math.round(paint.naturalH * scale));

    const stage = paintEl('paintStage');
    if (stage) {
      stage.style.width = displayW + 'px';
      stage.style.height = displayH + 'px';
    }

    paint.canvas.setDimensions({ width: displayW, height: displayH }, { cssOnly: true });

    const wrapper = paint.canvas.wrapperEl;
    if (wrapper) {
      wrapper.style.width = displayW + 'px';
      wrapper.style.height = displayH + 'px';
      wrapper.style.visibility = paint.showOriginal ? 'hidden' : 'visible';
    }

    if ((paint.tool === 'brush' || paint.tool === 'eraser') && paint.canvas.freeDrawingBrush) {
      paint.canvas.freeDrawingBrush.width = paintBrushWidth();
    }
  }

  async function ensurePaintOriginal(images, imagesBase, slot) {
    if (images.original && images.original.src) return images.original;

    const question = images.question;
    if (!question || !question.src) throw new Error('Сначала загрузите картинку вопроса.');

    setPaintStatus('Готовим оригинал из текущей картинки…');
    const response = await fetch(normalizeUrl(question.src), { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось прочитать картинку вопроса.');
    const blob = await response.blob();

    const result = await uploadBlob({
      packBase: state.file.replace(/\.json$/i, ''),
      slot: slot.replace(/-question$/, '-original'),
      blob,
      filename: 'original.png'
    });

    const original = { src: result.path, alt: '' };
    setPath(state.pack, `${imagesBase}.original`, original);
    markDirty();
    setStatus('Оригинал сохранён. Не забудьте сохранить пак.', 'ok');
    return original;
  }

  async function openPaintEditor(slot, questionBasePath) {
    if (!state.pack || !state.file) {
      alert('Сначала выберите или создайте пак.');
      return;
    }
    if (!window.fabric) {
      alert('Редактор картинок не загрузился. Обновите страницу.');
      return;
    }

    const imagesBase = questionBasePath.replace(/\.question$/, '');
    const images = getPath(state.pack, imagesBase);
    if (!images || !images.question || !images.question.src) {
      alert('Сначала загрузите картинку вопроса.');
      return;
    }

    paintEl('paintModal').style.display = 'flex';
    document.body.classList.add('paint-open');
    paintEl('paintSubtitle').textContent = slot;
    setPaintStatus('Подготовка оригинала…');

    try {
      const original = await ensurePaintOriginal(images, imagesBase, slot);
      await initPaintEditor({ slot, imagesBase, original, edited: images.question });
    } catch (e) {
      setPaintStatus(e.message || 'Не удалось открыть редактор', 'error');
    }
  }

  async function initPaintEditor({ slot, imagesBase, original, edited }) {
    if (paint && paint.canvas) {
      try { paint.canvas.dispose(); } catch (e) { /* ignore */ }
    }

    const displayEl = paintEl('paintOriginal');
    const editedImage = new Image();
    editedImage.crossOrigin = 'anonymous';
    const editedLoaded = new Promise((resolve, reject) => {
      editedImage.onload = resolve;
      editedImage.onerror = () => reject(new Error('Не удалось загрузить картинку вопроса.'));
    });
    editedImage.src = normalizeUrl(edited.src);
    if (!editedImage.complete || !editedImage.naturalWidth) await editedLoaded;
    displayEl.src = editedImage.src;

    const naturalW = editedImage.naturalWidth || editedImage.width;
    const naturalH = editedImage.naturalHeight || editedImage.height;
    if (!naturalW || !naturalH) throw new Error('Не удалось определить размер картинки вопроса.');

    const originalSrc = normalizeUrl(original.src);
    const preloadOriginal = new Image();
    preloadOriginal.src = originalSrc;

    const canvasEl = paintEl('paintCanvas');
    const canvas = new fabric.Canvas(canvasEl, {
      selection: false,
      preserveObjectStacking: true,
      backgroundColor: null
    });
    canvas.setDimensions({ width: naturalW, height: naturalH });

    paint = {
      canvas,
      displayEl,
      editedImage,
      editedSrc: editedImage.src,
      originalSrc,
      naturalW,
      naturalH,
      slot,
      imagesBase,
      history: [],
      historyIndex: -1,
      tool: 'brush',
      shape: null,
      shapeStart: null,
      dirty: false,
      showOriginal: false,
      displayScale: 1,
      resizeObserver: null
    };

    canvas.on('path:created', savePaintHistory);
    canvas.on('object:modified', savePaintHistory);
    canvas.on('mouse:down', (opt) => {
      if (paint.tool === 'brush' || paint.tool === 'eraser' || paint.tool === 'select') return;
      const pointer = canvas.getScenePoint(opt.e);
      paint.shapeStart = pointer;
      paint.shape = createPaintShape(paint.tool, pointer, pointer);
      if (paint.shape) canvas.add(paint.shape);
    });
    canvas.on('mouse:move', (opt) => {
      if (!paint.shape || !paint.shapeStart) return;
      const pointer = canvas.getScenePoint(opt.e);
      updatePaintShape(paint.shape, paint.shapeStart, pointer);
      canvas.requestRenderAll();
    });
    canvas.on('mouse:up', () => {
      if (paint.shape) {
        const shape = paint.shape;
        const tiny = shape.type === 'line'
          ? Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 3
          : (shape.width < 3 || shape.height < 3);
        if (tiny) canvas.remove(shape);
        paint.shape = null;
        paint.shapeStart = null;
        savePaintHistory();
      } else if (paint.tool === 'eraser') {
        savePaintHistory();
      }
    });

    const wrap = document.querySelector('.paint-canvas-wrap');
    if (wrap && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => fitPaintCanvas());
      observer.observe(wrap);
      paint.resizeObserver = observer;
    }

    resetPaintOriginalToggle();
    setPaintTool('brush');
    fitPaintCanvas();
    savePaintHistory();
    paint.dirty = false;
    updatePaintHistoryButtons();
    paintEl('paintSubtitle').textContent = `${slot} · ${edited.src.split('/').pop()}`;
    setPaintStatus('Готово. Рисуйте и сохраните вопрос.', 'ok');
  }

  async function savePaintQuestion() {
    if (!paint || !state.pack || !state.file) return;
    const images = getPath(state.pack, paint.imagesBase);
    if (!images || !images.question) return;

    if (paint.showOriginal) {
      const original = images.original;
      if (!original || !original.src) {
        setPaintStatus('Оригинал не найден.', 'error');
        return;
      }

      setPath(state.pack, `${paint.imagesBase}.question`, {
        src: original.src,
        alt: original.alt || ''
      });

      const slotElement = findSlot(paint.slot);
      if (slotElement) {
        const input = slotElement.querySelector('.image-path');
        if (input) input.value = original.src;
        updateImagePreview(slotElement, original.src);
      }

      markDirty();
      paint.dirty = false;
      setStatus('Вопрос сохранён как оригинальная картинка. Не забудьте сохранить пак.', 'ok');
      closePaintEditor(true);
      return;
    }

    try {
      setPaintStatus('Сохраняем картинку…');
      const out = document.createElement('canvas');
      out.width = paint.naturalW;
      out.height = paint.naturalH;
      const ctx = out.getContext('2d');
      ctx.drawImage(paint.editedImage, 0, 0, paint.naturalW, paint.naturalH);
      ctx.drawImage(paint.canvas.lowerCanvasEl, 0, 0, paint.naturalW, paint.naturalH);
      const dataUrl = out.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const result = await uploadBlob({
        packBase: state.file.replace(/\.json$/i, ''),
        slot: paint.slot,
        blob,
        filename: 'edited.png'
      });

      setPath(state.pack, `${paint.imagesBase}.question.src`, result.path);

      const slotElement = findSlot(paint.slot);
      if (slotElement) {
        const input = slotElement.querySelector('.image-path');
        if (input) input.value = result.path;
        updateImagePreview(slotElement, result.path);
      }

      markDirty();
      paint.dirty = false;
      setStatus('Картинка вопроса обновлена. Не забудьте сохранить пак.', 'ok');
      closePaintEditor(true);
    } catch (e) {
      setPaintStatus('Ошибка сохранения: ' + e.message, 'error');
    }
  }

  async function setOriginalAsAnswer(slot) {
    if (!state.pack || !state.file) {
      alert('Сначала выберите или создайте пак.');
      return;
    }

    const slotElement = findSlot(slot);
    if (!slotElement) return;

    const questionBasePath = slotElement.dataset.pathBase;
    if (!questionBasePath) return;
    const imagesBase = questionBasePath.replace(/\.question$/, '');
    const images = getPath(state.pack, imagesBase);
    if (!images || !images.question || !images.question.src) {
      alert('Сначала загрузите картинку вопроса.');
      return;
    }

    try {
      setStatus('Готовим оригинал для ответа…');
      const original = await ensurePaintOriginal(images, imagesBase, slot);
      setPath(state.pack, `${imagesBase}.answer`, {
        src: original.src,
        alt: original.alt || ''
      });

      const answerSlot = findSlot(slot.replace(/-question$/, '-answer'));
      if (answerSlot) {
        const input = answerSlot.querySelector('.image-path');
        if (input) input.value = original.src;
        updateImagePreview(answerSlot, original.src);
      }

      markDirty();
      setStatus('Оригинал подставлен в ответ. Не забудьте сохранить пак.', 'ok');
    } catch (e) {
      setStatus('Не удалось подставить оригинал в ответ: ' + e.message, 'error');
    }
  }

  function moveAnswerToQuestion(slot) {
    if (!state.pack) {
      alert('Сначала выберите или создайте пак.');
      return;
    }

    const slotElement = findSlot(slot);
    if (!slotElement) return;

    const answerBasePath = slotElement.dataset.pathBase || '';
    if (!answerBasePath.endsWith('.answer')) return;
    const imagesBase = answerBasePath.replace(/\.answer$/, '');
    const images = getPath(state.pack, imagesBase);
    const answer = images && images.answer;
    const src = String((answer && answer.src) || '').trim();
    if (!src) {
      alert('Сначала загрузите картинку ответа.');
      return;
    }

    const alt = (answer && answer.alt) || '';

    // Картинка ответа копируется в вопрос и становится оригиналом. Ответ не
    // трогаем: при необходимости его можно удалить кнопкой «Удалить».
    setPath(state.pack, `${imagesBase}.question`, { src, alt });
    setPath(state.pack, `${imagesBase}.original`, { src, alt });

    const questionSlot = findSlot(slot.replace(/-answer$/, '-question'));
    if (questionSlot) {
      const questionInput = questionSlot.querySelector('.image-path');
      if (questionInput) questionInput.value = src;
      const questionAlt = questionSlot.querySelector('.image-alt');
      if (questionAlt) questionAlt.value = alt;
      updateImagePreview(questionSlot, src);
    }

    markDirty();
    setStatus('Картинка скопирована в вопрос. Ответ не изменён. Не забудьте сохранить пак.', 'ok');
  }

  function cleanAnswerFromOriginal() {
    if (!paint || !state.pack) return;
    const images = getPath(state.pack, paint.imagesBase);
    const original = images && images.original;
    if (!original || !original.src) {
      setPaintStatus('Оригинал ещё не создан.', 'error');
      return;
    }

    setPath(state.pack, `${paint.imagesBase}.answer`, { src: original.src, alt: original.alt || '' });

    const answerSlot = findSlot(paint.slot.replace(/-question$/, '-answer'));
    if (answerSlot) {
      const input = answerSlot.querySelector('.image-path');
      if (input) input.value = original.src;
      updateImagePreview(answerSlot, original.src);
    }

    markDirty();
    setStatus('Чистая картинка подставлена в ответ. Не забудьте сохранить пак.', 'ok');
    setPaintStatus('Оригинал подставлен в ответ.', 'ok');
  }

  function closePaintEditor(force = false) {
    if (!paint) {
      resetPaintOriginalToggle();
      paintEl('paintModal').style.display = 'none';
      document.body.classList.remove('paint-open');
      return;
    }
    if (!force && paint.dirty && !confirm('Закрыть редактор без сохранения изменений?')) return;

    resetPaintOriginalToggle();
    const current = paint;
    paint = null;
    if (current.resizeObserver) current.resizeObserver.disconnect();
    try { current.canvas.dispose(); } catch (e) { /* ignore */ }
    paintEl('paintModal').style.display = 'none';
    paintEl('paintSubtitle').textContent = '';
    setPaintStatus('');
    document.body.classList.remove('paint-open');
  }

  function bindPaintEvents() {
    document.querySelectorAll('[data-paint-tool]').forEach((button) => {
      button.addEventListener('click', () => setPaintTool(button.dataset.paintTool));
    });

    paintEl('paintColor').addEventListener('input', () => {
      if (paint && paint.tool === 'brush' && paint.canvas.freeDrawingBrush) {
        paint.canvas.freeDrawingBrush.color = paintEl('paintColor').value;
      }
    });

    paintEl('paintSize').addEventListener('input', () => {
      if (paint && (paint.tool === 'brush' || paint.tool === 'eraser') && paint.canvas.freeDrawingBrush) {
        paint.canvas.freeDrawingBrush.width = paintBrushWidth();
      }
    });

    paintEl('paintSizeUp').addEventListener('click', () => stepPaintSize(1));
    paintEl('paintSizeDown').addEventListener('click', () => stepPaintSize(-1));
    paintEl('paintSize').addEventListener('change', () => {
      paintEl('paintSize').value = String(readPaintSize());
      if (paint && (paint.tool === 'brush' || paint.tool === 'eraser') && paint.canvas.freeDrawingBrush) {
        paint.canvas.freeDrawingBrush.width = paintBrushWidth();
      }
    });

    paintEl('paintShowOriginal').addEventListener('change', (event) => {
      setPaintOriginal(event.target.checked);
    });

    paintEl('paintUndo').addEventListener('click', () => {
      if (paint) restorePaintHistory(paint.historyIndex - 1);
    });
    paintEl('paintRedo').addEventListener('click', () => {
      if (paint) restorePaintHistory(paint.historyIndex + 1);
    });
    paintEl('paintReset').addEventListener('click', () => {
      if (!paint) return;
      paint.canvas.getObjects().forEach((object) => {
        if (!object.isBackground) paint.canvas.remove(object);
      });
      setPaintOriginal(false);
      setPaintTool('brush');
      paint.canvas.requestRenderAll();
      savePaintHistory();
    });

    paintEl('paintSave').addEventListener('click', savePaintQuestion);
    paintEl('paintCleanAnswer').addEventListener('click', cleanAnswerFromOriginal);
    paintEl('paintClose').addEventListener('click', () => closePaintEditor());
    paintEl('paintCancel').addEventListener('click', () => closePaintEditor());

    document.addEventListener('keydown', (event) => {
      if (!paint) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePaintEditor();
      }

      const typing = event.target && (
        event.target.tagName === 'INPUT'
        || event.target.tagName === 'TEXTAREA'
        || event.target.isContentEditable
      );
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
        const active = paint.canvas.getActiveObject();
        if (active && !active.isBackground) {
          event.preventDefault();
          const objects = active.type === 'activeSelection' ? active.getObjects().slice() : [active];
          objects.forEach((object) => paint.canvas.remove(object));
          paint.canvas.discardActiveObject();
          paint.canvas.requestRenderAll();
          savePaintHistory();
          setPaintStatus('Объект удалён. Ctrl+Z вернёт его.', 'ok');
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) restorePaintHistory(paint.historyIndex + 1);
        else restorePaintHistory(paint.historyIndex - 1);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        restorePaintHistory(paint.historyIndex + 1);
      }
    });
  }

  function bindEditorEvents() {
    $('#editorTabs').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      state.activeRound = button.dataset.tab;
      renderTabs();
      renderRound(state.activeRound);
    });

    const root = $('#editorRoot');

    root.addEventListener('input', (event) => {
      const path = event.target.dataset.path;
      if (!path) return;

      setPath(state.pack, path, event.target.value);
      markDirty();

      if (path.endsWith('.name')) {
        const card = event.target.closest('.category-card');
        if (card) {
          const title = card.querySelector('.category-title');
          if (title) title.textContent = event.target.value || 'Без названия';
        }
      }
    });

    root.addEventListener('change', (event) => {
      if (event.target.matches('.image-path')) {
        const value = event.target.value.trim();

        if (isExternalImageRef(value)) {
          event.target.value = '';
          const path = event.target.dataset.path;
          if (path) setPath(state.pack, path, '');
          const slot = event.target.closest('.image-slot');
          if (slot) updateImagePreview(slot, '');
          setStatus('Внешние ссылки не поддерживаются. Скачайте картинку и загрузите её кнопкой «Загрузить».', 'error');
          return;
        }

        const slot = event.target.closest('.image-slot');
        if (slot) updateImagePreview(slot, value);
      }

      if (event.target.matches('[data-upload-input]')) {
        const file = event.target.files && event.target.files[0];
        const slot = event.target.dataset.uploadInput;
        event.target.value = '';
        if (file) uploadImage(slot, file);
      }
    });

    root.addEventListener('click', (event) => {
      const removeTheme = event.target.closest('[data-remove-final]');
      if (removeTheme) {
        if (!state.pack || state.pack.final.themes.length <= 1) return;
        state.pack.final.themes.splice(Number(removeTheme.dataset.removeFinal), 1);
        markDirty();
        renderRound('final');
        return;
      }

      const addTheme = event.target.closest('#addFinalTheme');
      if (addTheme) {
        if (!state.pack || state.pack.final.themes.length >= 7) return;
        state.pack.final.themes.push({
          theme: '',
          text: '',
          answer: '',
          images: {
            question: { src: '', alt: '' },
            answer: { src: '', alt: '' }
          }
        });
        markDirty();
        renderRound('final');
        return;
      }

      const editButton = event.target.closest('[data-edit-image]');
      if (editButton) {
        const slotElement = findSlot(editButton.dataset.editImage);
        if (slotElement && slotElement.dataset.pathBase) {
          openPaintEditor(slotElement.dataset.slot, slotElement.dataset.pathBase);
        }
        return;
      }

      const originalAnswerButton = event.target.closest('[data-original-answer]');
      if (originalAnswerButton) {
        const slotElement = findSlot(originalAnswerButton.dataset.originalAnswer);
        if (slotElement) setOriginalAsAnswer(slotElement.dataset.slot);
        return;
      }

      const answerToQuestionButton = event.target.closest('[data-answer-to-question]');
      if (answerToQuestionButton) {
        const slotElement = findSlot(answerToQuestionButton.dataset.answerToQuestion);
        if (slotElement) moveAnswerToQuestion(slotElement.dataset.slot);
        return;
      }

      const removeImageButton = event.target.closest('[data-remove-image]');
      if (removeImageButton) {
        const slotElement = findSlot(removeImageButton.dataset.removeImage);
        if (!slotElement) return;
        const basePath = slotElement.dataset.pathBase;
        if (basePath) {
          setPath(state.pack, `${basePath}.src`, '');
          if (basePath.endsWith('.question')) {
            setPath(state.pack, `${basePath.replace(/\.question$/, '')}.original`, { src: '', alt: '' });
          }
        }
        const input = slotElement.querySelector('.image-path');
        if (input) input.value = '';
        updateImagePreview(slotElement, '');
        markDirty();
        setStatus('Картинка удалена. Не забудьте сохранить пак.', 'ok');
        return;
      }

      const button = event.target.closest('[data-upload]');
      if (!button) return;
      const slot = findSlot(button.dataset.upload);
      if (!slot) return;
      const input = slot.querySelector('[data-upload-input]');
      if (input) input.click();
    });

    $('#packTitle').addEventListener('input', (event) => {
      if (!state.pack) return;
      state.pack.title = event.target.value;
      markDirty();
    });

    $('#packSelect').addEventListener('change', async (event) => {
      const file = event.target.value;
      if (!file || file === state.file) return;

      if (state.dirty && !confirm('Есть несохранённые изменения. Переключить пак без сохранения?')) {
        event.target.value = state.file || '';
        return;
      }

      try {
        await loadPack(file);
      } catch (e) {
        setStatus(e.message, 'error');
      }
    });

    $('#savePack').addEventListener('click', savePack);
    $('#cleanupImages').addEventListener('click', cleanupImages);

    $('#newPack').addEventListener('click', () => {
      if (state.dirty && !confirm('Есть несохранённые изменения. Создать новый пак без сохранения?')) return;

      const raw = prompt('Имя нового пака (латиница, цифры, _ и -, например new_pack.json):', 'new_pack.json');
      if (!raw) return;

      let file = raw.trim();
      if (!file.toLowerCase().endsWith('.json')) file += '.json';
      if (!/^[a-zA-Z0-9._-]+\.json$/.test(file)) {
        alert('Имя файла должно содержать только латиницу, цифры, точку, _ и - и оканчиваться на .json');
        return;
      }
      if (state.packs.some((pack) => pack.file === file) && !confirm(`Пак ${file} уже существует. Перезаписать его?`)) {
        return;
      }

      state.file = file;
      state.pack = normalizePackForEditor(createBlankPack());
      state.activeRound = 'round1';
      state.dirty = true;

      $('#packTitle').value = state.pack.title;
      $('#packMeta').textContent = state.file;
      $('#packCard').style.display = 'block';
      $('#editorTabs').style.display = 'flex';
      $('#editorStatus').textContent = 'Новый пак (ещё не сохранён)';
      $('#savePack').disabled = false;
      $('#downloadPack').disabled = false;
      $('#cleanupImages').disabled = false;
      setStatus('Заполните пак и нажмите «Сохранить»');

      renderTabs();
      renderRound(state.activeRound);
    });

    $('#downloadPack').addEventListener('click', () => {
      if (!state.pack) return;
      const clean = cleanPackForSave(state.pack);
      const blob = new Blob([JSON.stringify(clean, null, 2) + '\n'], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = state.file || 'pack.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    $('#importPack').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;

      if (state.dirty && !confirm('Есть несохранённые изменения. Загрузить JSON вместо текущего пака?')) return;

      try {
        const parsed = JSON.parse(await file.text());

        if (!state.file) {
          const raw = prompt('Имя файла для сохранения импортированного пака:', file.name || 'imported.json');
          if (!raw) return;
          let name = raw.trim();
          if (!name.toLowerCase().endsWith('.json')) name += '.json';
          if (!/^[a-zA-Z0-9._-]+\.json$/.test(name)) {
            alert('Имя файла должно содержать только латиницу, цифры, точку, _ и - и оканчиваться на .json');
            return;
          }
          if (state.packs.some((pack) => pack.file === name) && !confirm(`Пак ${name} уже существует. Перезаписать его?`)) {
            return;
          }
          state.file = name;
          $('#packMeta').textContent = state.file;
          $('#packCard').style.display = 'block';
          $('#savePack').disabled = false;
          $('#downloadPack').disabled = false;
          $('#cleanupImages').disabled = false;
        }

        state.pack = normalizePackForEditor(parsed);
        state.activeRound = 'round1';
        state.dirty = true;

        $('#packTitle').value = state.pack.title || '';
        $('#editorTabs').style.display = 'flex';
        $('#editorStatus').textContent = `Импортирован ${file.name}`;
        setStatus('Импортировано. Проверьте данные и нажмите «Сохранить».');

        renderTabs();
        renderRound(state.activeRound);
      } catch (e) {
        setStatus('Не удалось прочитать JSON: ' + e.message, 'error');
      }
    });

    $('#saveToken').addEventListener('click', async () => {
      const token = $('#editorToken').value.trim();
      if (!token) {
        $('#tokenError').textContent = 'Введите токен.';
        return;
      }

      state.token = token;
      sessionStorage.setItem('si_editor_token', token);
      $('#tokenError').textContent = '';

      try {
        await loadPacks();
      } catch (e) {
        $('#tokenError').textContent = e.status === 401 ? 'Неверный токен.' : e.message;
      }
    });

    $('#editorToken').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $('#saveToken').click();
    });

    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  async function init() {
    try {
      const status = await api('/api/editor/status');

      if (status.tokenRequired && !state.token) {
        showTokenCard('Введите токен редактора.');
        return;
      }

      if (!status.tokenRequired && !status.local) {
        $('#editorStatus').textContent = 'Редактор доступен только с компьютера, где запущен сервер. Задайте editor.token в game.config.json для доступа по сети.';
        return;
      }

      await loadPacks();
    } catch (e) {
      if (e.status === 401) return;
      $('#editorStatus').textContent = e.message;
      setStatus(e.message, 'error');
    }
  }

  bindEditorEvents();
  bindPaintEvents();
  init();
})();
