# 🚀 Simple Quiz MVP — Упрощённая версия

## Цель
**Определить, кто быстрее ответит** на вопрос. Всё остальное — фантики для будущего.

---

## Что убрали
- ❌ Историю игр
- ❌ ТВ-табло
- ❌ Разные типы игр (только "кто быстрей")
- ❌ Сложный роутинг комнат
- ❌ Админку с редактированием вопросов

## Что осталось
- ✅ Главная: "Создать игру" / "Войти"
- ✅ Лобби: ожидание игроков
- ✅ **Главный экран — Приём ответов** (buzz phase)
- ✅ Итоги: кто победил

---

## Дизайн (минимализм)

### Цвета
```css
--bg: #0b0f1a       /* фон */
--surface: #141a2b  /* карточки */
--text: #e8eefc     /* основной текст */
--accent: #22d3ee   /* cyan — активное */
--success: #a3e635  /* lime — победа */
--danger: #fb7185   /* rose — проигрыш */
```

### Кнопка "Я знаю!" (критично!)
```css
min-height: 32vh        /* не меньше трети экрана */
font-size: clamp(24px, 6vw, 48px)
font-weight: 700
background: var(--accent)
touch-action: manipulation
user-select: none
```

---

## Структура проекта (минималистичная)

```
simple-quiz/
├── client/
│   ├── src/
│   │   ├── App.tsx              /* роутинг: / | /lobby | /r/:code | /result */
│   │   ├── components/
│   │   │   ├── BuzzButton.tsx   /* ОГРОМНАЯ кнопка "Я знаю!" */
│   │   │   ├── PlayerCard.tsx   /* ник, отставание в ms */
│   │   │   └── ResultDisplay.tsx/* кто первый, кто второй... */
│   │   ├── screens/
│   │   │   ├── HomePage.tsx     /* список игр / создать */
│   │   │   ├── LobbyPage.tsx    /* ожидание игроков */
│   │   │   └── ResultPage.tsx   /* кто победил */
│   │   └── styles.css           /* дизайн-токены */
│   └── vite.config.ts
├── server/
│   ├── index.ts                 /* Fastify + Socket.IO */
│   └── db.ts                    /* SQLite: 1 таблица игр */
├── shared/
│   └── protocol.ts              /* Zod-схемы для buzz/verdict */
└── package.json
```

---

## Протокол сокета (минимум)

| От кого | Событие | Что несёт | Куда |
|---------|---------|-----------|------|
| клиент → сервер | `createGame` | `{ question, timeLimit }` | админ создаёт игру |
| сервер → все игроки | `startRound` | `{ question, buzzOpen: true }` | открыта фаза приёма ответов |
| любой игрок → сервер | `buzz` | `{ playerColor }` | кто-то нажал кнопку |
| клиент (игрок) → сервер | `verdict` | `{ isCorrect }` | только ведущий принимает вердикт |
| сервер → все | `playerBuzzed` | `{ name, color, offsetMs }` | обновление очереди |
| сервер → все | `roundFinished` | `{ winner, scores }` | конец раунда |

---

## Приоритеты реализации

### P0 — MVP (1-2 дня)
- [ ] Fastify + Socket.IO
- [ ] SQLite: таблица игр, записи результатов
- [ ] `BuzzButton.tsx`: огромная кнопка (32vh+)
- [ ] `PlayerCard.tsx`: ник, отставание (+0.42 с)
- [ ] Фаза приёмa ответов: очередь игроков, анимация нажатия
- [ ] Простые вердикты: "Верно" / "Неверно"

### P1 — Полный цикл (3-5 дней)
- [ ] Роутинг: `/` → `/lobby` → `/r/:code` → `/result`
- [ ] Итоговая страница: таблица очков, победитель
- [ ] Звуки (Web Audio API): клик, победа

### P2 — Polish (будущее)
- [ ] История игр
- [ ] ТВ-табло
- [ ] Anti-cheat
- [ ] Wake Lock

---

## Как проверить макет кнопки "Я знаю!"

```html
<!-- На телефоне в inpectore: body { width: 390px; height: 844px; } -->
<div class="buzz-container">
  <h2 id="question">Нажмите, когда увидите вопрос...</h2>
  
  <div id="playerQueue" aria-live="polite"></div>
  
  <!-- Критично! -->
  <button 
    id="buzzBtn"
    class="buzz-btn"
    style="min-height: 32vh; font-size: clamp(24px, 6vw, 48px); font-weight: 700;"
  >
    Я ЗНАЮ!
  </button>
</div>
```

---

## Следующие шаги

1. Утверждаем упрощённую структуру?
2. Создаём папку `simple-quiz-mockups/` с макетами?
3. Начинаем реализацию P0 (сервер + BuzzButton)?

Подтверждаем — и погнали! 🚀
