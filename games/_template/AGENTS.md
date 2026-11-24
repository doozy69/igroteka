# AGENTS.md — шаблон новой игры

Это **шаблон**, а не игра. При копировании замени всё, что помечено как шаблонное.

## Как использовать

1. Скопируй папку в `games/<id>`.
2. Поменяй `name` в `package.json`, тексты в `public/`, `game` в health-ответе.
3. Выбери свободный порт `8104–8199` и поменяй `DEFAULT_PORT` в `server.mjs`.
4. Добавь запись в корневой `games.json`.
5. Запусти отдельно: `npm install && npm start`.
6. Проверь через платформу и с телефона по LAN.
7. Перепиши этот файл под реальную игру.

## Структура

| Путь | Что это |
|---|---|
| `server.mjs` | Express + Socket.IO, health, LAN-IP, статика |
| `public/index.html` | экран игры |
| `public/style.css` | стили |
| `public/app.js` | клиент |
| `package.json` | зависимости и `npm start` |

## Контракт

- `process.env.PORT`, прослушивание `0.0.0.0`.
- `/api/health` → `{ status: "ok", game: "<id>", uptime }`.
- `/api/net` → `{ ip, port, addresses }` для QR и ссылок гостям.
- Свои `data/` и `questions/`, если появятся.
- Никаких импортов из других игр.
- Фиксированный порт, без автопоиска.

## Проверка

```bat
npm install
npm start
```

- `http://localhost:<port>/` открывается;
- `http://localhost:<port>/api/health` отвечает `ok`;
- кнопка «Проверить связь» получает ответ через Socket.IO;
- портал показывает карточку и статус «в сети».
