# Шаблон новой игры

Не запускайте шаблон как игру: скопируйте папку и замените тексты.

```bat
cd D:\igroteka
xcopy games\_template games\mygame /E /I
```

Затем:

1. `package.json` — новое имя.
2. `server.mjs` — `DEFAULT_PORT` и `game` в `/api/health`.
3. `public/` — название и интерфейс.
4. `games.json` — запись с тем же портом.
5. `AGENTS.md` — описание новой игры.

Полная инструкция: `docs/NEW_GAME.md`.
