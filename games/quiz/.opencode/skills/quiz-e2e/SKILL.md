---
name: E2E проверка Quiz Arena (Playwright)
description: Сквозная проверка LAN Quiz Race в Playwright, 4 браузерных контекста (админ и 3 игрока), проверки таймингов, вердиктов, истории, мобильных вьюпортов, чистой консоли и отсутствия внешних запросов.
---

# E2E проверка Quiz Arena

## 1. Конфигурация

- `playwright.config.ts`: `testDir: './tests/e2e'`, `workers: 1` (общая БД и сервер), `retries: 0` локально.
- `webServer`: `npm run build && npm start -- --port <тестовый> --data ./data-e2e`, чтобы e2e не трогал боевую историю.
- Каждый прогон — чистая `data-e2e/` (удалять в `globalSetup`).
- Артефакты: `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, `screenshot: 'only-on-failure'`.

## 2. Контексты

```ts
const admin  = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const p1     = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p2     = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p3     = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
```

Админ — отдельный `localStorage` (там `quiz:admin:<code>`), поэтому контексты не смешивать и не переиспользовать.

## 3. Основной сценарий

1. Админ: `/` → карточка «Кто быстрее» → «Создать комнату» (`Раунд 1`, ник `Игрок 1`).
2. Админ получает `code`, `adminKey` в `localStorage`.
3. Три игрока: `/r/<code>` → ник → видят друг друга и админа в списке.
4. Админ: «Начать игру» → вводит вопрос → «Принимаю ответы».
5. Проверить: у всех игроков кнопка активна и занимает ≥ 32vh.
6. Игроки жмут с задержками 0 / ~300 / ~700 мс → у всех одинаковый порядок, лидер `0.00 с`.
7. Вердикт «Верно +1» лидеру → счёт +1 у всех клиентов, фаза `round_result`.
8. Следующий вопрос → первым жмёт игрок B → «Неверно» → у B ✗, он в конце очереди, следующий лидер получает вердикт.
9. «Завершить игру» → итоговая таблица, победитель совпадает.
10. `/history` → матч есть; `/history/:matchId` → таблица и раунды.
11. Перезапуск сервера → `/api/history` и страница истории сохраняют матч.

## 4. Обязательные проверки

| Что | Как |
|---|---|
| Порядок и тайминги совпадают у всех | собрать тексты очереди с 4 страниц, сравнить списки ников; gap ±1 мс |
| Кнопка неактивна до сигнала | `expect(button).toBeDisabled()` в фазе `question` |
| Нажатие вне окна игнорируется | `page.evaluate` вызов `buzz` до `openBuzz` → ошибка `INVALID_STATE`, очередь пуста |
| +1 виден всем ≤ 300 мс | замерить `Date.now()` до клика админа и до появления счёта на клиенте игрока |
| «Неверно» → конец очереди, можно нажать снова | позиция изменилась, кнопка снова активна, новая запись с новым временем |
| Поздний вход не ломает игру | новый контекст входит в `buzz_open`, получает 0 очков, видит состояние |
| Перезагрузка игрока/админа | `page.reload()` → место в очереди и `adminKey` сохраняются |
| 360×640 без горизонтального скролла | `document.documentElement.scrollWidth <= clientWidth` на всех экранах |
| Прямая ссылка `/r/:code` | открывается и работает в новом контексте |
| Консоль чистая | ни одного `error`/`pageerror` на всех страницах |
| Нет внешних запросов | перехват `request`: все URL same-origin (кроме `ws://` на тот же хост) |

## 5. Сеть и консоль

```ts
const external: string[] = [];
page.on('request', r => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.push(r.url());
});
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
```

В конце каждого теста: `expect(external).toEqual([])`, `expect(errors).toEqual([])`.

## 6. Вспомогательные хелперы

- `createRoom(page, { roomName, nickname })` — возвращает `code`.
- `joinRoom(page, code, nickname)`.
- `adminAction(page, 'start' | 'openBuzz' | 'verdict' | 'finish')` — по `data-testid`, не по тексту.
- `queueSnapshot(page)` — массив `{ place, nick, gap, status }`.
- `expectNoHorizontalScroll(page)`.

Все интерактивные элементы получают `data-testid` в коде приложения — e2e не должен зависеть от вёрстки и текстов.

## 7. Что не делать

- ❌ Ждать `waitForTimeout` вместо ожидания состояния/события.
- ❌ Использовать один контекст для админа и игрока.
- ❌ Проверять тайминги по пикселям скриншота — только по DOM-тексту.
- ❌ Гонять e2e против боевой `data/app.db`.
- ❌ Полагаться на фиксированные миллисекунды нажатий — задавать задержки с допуском.
