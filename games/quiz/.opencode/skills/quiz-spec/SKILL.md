---
name: LAN Quiz Race — спецификация
description: Сжатая спецификация полной версии проекта LAN Quiz Race (SQLite, React, борд игр). Для упрощённой версии используй prompt-quiz-lite.md, а не этот файл.
---

> **Актуальность:** описывает **полную** версию проекта (SQLite, React 19, Tailwind, борд игр).
> Если проект делается по `prompt-quiz-lite.md` (одна игра, JSON-файлы, vanilla JS),
> этот скилл не применять — там другой стек и упрощённая логика.

# LAN Quiz Race — рабочая выжимка ТЗ

**Полное ТЗ:** `prompt-quiz-lan.md` в корне проекта (751 строка).
Этот файл — выжимка для быстрой ориентации. При любом расхождении приоритет у ТЗ.

## 1. Что строим

Игра для живого мероприятия в локальной сети без интернета:

- Windows-ноутбук запускает сервер двойным кликом по `start.bat`, в консоли печатаются LAN-адреса вида `http://192.168.1.10:8103`.
- Игроки заходят с телефонов по этому адресу, видят борд игр → комнаты → вводят ник.
- Создатель комнаты — администратор (ведущий) и **тоже играет**.
- Ведущий читает вопрос вслух, жмёт «Принимаю ответы», игроки жмут «Я знаю!».
- Порядок и тайминги нажатий считает только сервер; ведущий ставит «Верно +1» / «Неверно».
- Итоги сохраняются в SQLite, публичная история доступна всем.
- Релиз — self-contained ZIP с portable Node.js: на целевой машине не нужно ничего устанавливать.

## 2. Стек (не менять)

- TypeScript `strict: true` во всём проекте.
- Node.js LTS 24+ (обязателен встроенный `node:sqlite`), версия в `engines` и `.node-version`.
- Fastify 5 (HTTP + статика) + Socket.IO 4 (WS + polling fallback для плохого Wi-Fi).
- БД: `node:sqlite` → `DatabaseSync`, WAL, `foreign_keys=ON`, доступ только через репозитории.
- React 19 + Vite + Tailwind CSS 4 + `react-router-dom` + `socket.io-client`.
- Zod-схемы в `src/shared` — общие для сервера и клиента.
- Состояние клиента: Context + `useReducer` (или zustand). Источник истины — сервер.
- Vitest (unit + integration), Playwright (e2e), npm + коммит `package-lock.json`.
- ESLint 9 flat config + Prettier, обязательный `npm run typecheck`.

Запрещено: Docker, нативные npm-модули (`better-sqlite3`, `sharp`, `bcrypt`), CDN, Google Fonts, аналитика, внешние API, установка Node.js на целевой машине, права администратора.

## 3. Фазы комнаты

```
lobby → question → buzz_open → round_result → question → … → finished
```

| Фаза | Что происходит | Действия |
|---|---|---|
| `lobby` | Игроки подключаются, очки 0 | админ: `start`; игрок: join/leave |
| `question` | Ведущий читает вслух, нажатия запрещены | админ: `setQuestion`, `openBuzz`, `finish` |
| `buzz_open` | Приём открыт, формируется очередь | игрок: `buzz`; админ: `verdict`, `closeBuzz`, `nextQuestion` (после вердикта), `finish`, `buzz` |
| `round_result` | Итог раунда | админ: `nextQuestion`, `finish` |
| `finished` | Итоги, комната read-only, матч сохранён | все: посмотреть, выйти |

Переходы:

- `openBuzz` фиксирует `openedAt = now()` (серверное монотонное время) и обнуляет очередь раунда.
- `verdict(correct=true)` → лидеру +1, статус `correct`, раунд закрывается → `round_result`.
- `verdict(correct=false)` → статус `wrong`, лидер уходит из активной очереди в конец (если нажмёт снова), следующий `waiting` становится лидером; фаза остаётся `buzz_open`.
- `closeBuzz` → `round_result` без очков (никто не ответил верно / ноль нажатий).
- `nextQuestion` → `round_index += 1`, очистить очередь и вопрос → `question`.
- `finish` → из любой фазы кроме `lobby`, сохранить матч, → `finished`. Идемпотентно.

## 4. Инварианты (нарушение = баг)

1. Время только серверное (`performance.now()` / монотонное); клиентское время не влияет на порядок.
2. `buzz` принимается только в `buzz_open`; одна `waiting`-запись на игрока; rate limit 1 раз в 250 мс.
3. Порядок — по серверному `seq`; `deltaMs = max(0, t_press - openedAt)`; лидер `0.00 с`, остальные `+X.XX с` (gap от лидера).
4. Верный ответ = ровно **+1 очко** (`speedBonus: false` в MVP).
5. Клиент никогда не считает очки и порядок — только отображает серверные данные.
6. Любой реконнект → `state:snapshot` и полная перерисовка, без «догонки» событиями.
7. `finish` идемпотентен: повторный вызов не создаёт второй матч.
8. Реконнект по `playerToken` — 90 с, `adminKey` — 30 мин; позже вход с 0 очков.
9. Ники: trim, 2–20 символов, уникальность без учёта регистра, санитизация (React экранирует).
10. Все админ-действия проверяют `adminKey` (32 байта hex), иначе `FORBIDDEN`.
11. Ошибки не роняют сервер: Zod на каждый payload, единый error handler.
12. Один источник истины: типы событий и схемы — в `src/shared`, дублирование логики запрещено.

## 5. Socket.IO протокол

Все клиентские вызовы — с ack: `{ ok: true, data } | { ok: false, error: { code, message } }`.

Коды ошибок: `FORBIDDEN`, `ROOM_NOT_FOUND`, `NICK_TAKEN`, `INVALID_STATE`, `VALIDATION`, `RATE_LIMITED`, `ROOM_FULL`.

**Клиент → сервер:** `room:create`, `room:join`, `room:leave`, `room:list:subscribe`, `buzz`, `admin:start`, `admin:setQuestion`, `admin:openBuzz`, `admin:closeBuzz`, `admin:verdict`, `admin:nextQuestion`, `admin:finish`.

**Сервер → клиент:** `state:snapshot`, `players:updated`, `round:started`, `buzz:opened`, `buzz:entry`, `queue:updated`, `verdict`, `round:ended`, `game:finished`, `room:closed`, `error`, `rooms:updated`.

Ключевые payload'ы:

- `room:create { gameId, roomName, nickname }` → `{ code, roomId, playerId, playerToken, adminKey }`
- `room:join { code, nickname, playerToken? }` → `{ roomId, playerId, playerToken, snapshot }`
- `buzz { roomId }` → `{ entryId, seq, deltaMs, position }`
- `admin:verdict { roomId, adminKey, entryId, correct }` → `{ state }`
- `state:snapshot` — полный срез: фаза, игроки, раунд, вопрос (только админу/ТВ), очередь, `serverTime`.

## 6. HTTP API (только чтение)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | `{ status, version, uptime, db }` |
| GET | `/api/board` | борд из `config/board.json` |
| GET | `/api/games` | реализованные движки |
| GET | `/api/rooms?gameId=` | публичный список комнат |
| GET | `/api/rooms/:code` | валидность ссылки/QR |
| GET | `/api/history?page=&pageSize=` | история, по 20 |
| GET | `/api/history/:matchId` | детали матча |
| GET | `/api/config` | публичные лимиты |

Мутаций по REST нет — всё через WS. SPA-fallback: `/`, `/game/:gameId`, `/r/:code`, `/admin/:code`, `/history`, `/r/:code/display`.

## 7. Данные

SQLite `data/app.db` (WAL, FK), миграции версионированные и идемпотентные, **бэкап перед миграцией** в `data/backups/` (держать 10).

Таблицы: `schema_migrations`, `matches`, `match_players`, `match_rounds` + индекс `idx_matches_finished`.

- Даты — ISO-8601 UTC в БД, локальная зона только на клиенте.
- Матч пишется одной транзакцией; повторная финализация — no-op.
- Борд живёт в `config/board.json` с hot-reload по mtime; карточку можно добавить без кода и пересборки.
- Комнаты — в памяти процесса (MVP), теряются при рестарте.

## 8. Границы объёма

**P0 (обязательно):** борд, комнаты, полный игровой цикл, мобильный экран игрока, админ-панель, история в SQLite, переносимый ZIP + `start.bat`, unit + integration + e2e, русская документация.

**P1 (если не ломает сроки):** QR-код, синтезированные звуки и вибрация, ТВ-табло `/r/:code/display`, `test-portable.ps1`, экспорт CSV, переподключение без потери места в очереди.

**P2 (не делать, только точки расширения):** банк вопросов, боты, со-админы, редактирование борда из UI, PWA, Redis-адаптер.

## 9. Критерии приёмки (сокращённо)

1. `npm ci && npm run build && npm start` работает на чистой копии (Windows, Node LTS).
2. `npm run verify` зелёный, тесты без сети и без флаков.
3. Два браузерных контекста видят друг друга и общие очки.
4. Кнопка неактивна до `openBuzz`; нажатия вне окна игнорируются.
5. Порядок и тайминги одинаковы у всех (±1 мс), лидер `0.00 с`.
6. «Неверно» → ✗ и конец очереди, можно нажать снова; «Верно» → +1 виден всем ≤ 300 мс.
7. Завершение → итоговая таблица + запись в `/history`, переживает рестарт.
8. `/r/:code` (и QR) открывают комнату; поздний вход не ломает игру.
9. Перезагрузка страницы игроком/админом не теряет права и очки в пределах grace.
10. Логи в `data/logs/`, Ctrl+C завершает корректно, `/api/health` → 200.
11. 360×640 без горизонтального скролла и с достижимой кнопкой; ТВ 1920×1080 читается.
12. `build-archive.bat` собирает ZIP, `start.bat` поднимает сервер с PATH без Node.
13. В прод-сборке нет внешних сетевых запросов (проверить DevTools).
14. Борд расширяется правкой `config/board.json` без пересборки.
15. README позволяет человеку без контекста запустить проект и собрать архив.

## 10. Антипаттерны

- ❌ Хранить очки/порядок в клиенте или доверять клиентскому времени.
- ❌ Polling вместо WebSocket; полная перерисовка на каждое событие.
- ❌ Комнаты в БД на каждое событие.
- ❌ «Демо-режим», где админ работает только в одном браузере.
- ❌ TODO и заглушки в игровой логике, истории, сборке архива.
- ❌ Абсолютные пути и секреты, зашитые под машину разработчика.
- ❌ Тяжёлые UI-библиотеки и иконки из CDN.

## 11. Команды качества

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test        # vitest run
npm run verify      # typecheck && lint && test
npm run build       # tsc сервера + vite build
npm start           # прод-запуск
```
