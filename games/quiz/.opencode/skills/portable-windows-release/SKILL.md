---
name: Переносимая Windows-сборка Quiz Arena
description: Сборка self-contained ZIP с portable Node.js для Quiz Arena, start.bat, build-archive.ps1, fetch-portable-node.ps1, test-portable.ps1, пути с пробелами и кириллицей, проверка запуска без Node в PATH.
---

# Переносимая Windows-сборка

## 1. Цель

ZIP, который на **чистой** Windows 10/11 x64 запускается двойным кликом:

- Node.js, БД, интернет и права администратора на целевой машине не нужны;
- `start.bat` поднимает сервер, печатает LAN-адреса, открывает браузер;
- история в `data/app.db` переезжает вместе с архивом;
- путь распаковки может содержать пробелы и кириллицу.

## 2. Структура архива

```
quiz-arena-v1.0.0/
├─ start.bat            # главный файл
├─ stop.bat             # опционально
├─ config.json          # порт и настройки
├─ README.txt           # короткая инструкция по-русски
├─ VERSION.txt          # версия приложения, версия Node, дата сборки
├─ app/
│  ├─ dist/server/...   # main.js — скомпилированный сервер
│  ├─ dist/web/...      # статический фронтенд + index.html
│  ├─ node_modules/     # только production
│  └─ package.json
├─ runtime/
│  └─ node/             # node.exe + dll + LICENSE
└─ data/                # создаётся при первом запуске; БД копируется сборщиком
```

`data/` лежит **вне** `app/`: обновление приложения не затирает историю.

## 3. start.bat — обязательные правила

```bat
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "%~dp0runtime\node\node.exe" (
  echo [ERROR] runtime\node\node.exe not found. Unpack the archive completely.
  pause
  exit /b 1
)
if not exist "%~dp0app\dist\server\main.js" (
  echo [ERROR] app\dist\server\main.js not found.
  pause
  exit /b 1
)

"%~dp0runtime\node\node.exe" "%~dp0app\dist\server\main.js" --config "%~dp0config.json" --data "%~dp0data" %*
if errorlevel 1 pause
```

Требования:

- `chcp 65001` — кириллица в консоли.
- `cd /d "%~dp0"` — запуск из любого пути, включая пробелы.
- Только встроенный `node.exe`, **никогда** `node`/`npm` из PATH.
- Аргументы пробрасываются: `start.bat --no-open`, `start.bat --port 3100`, `start.bat --no-open --port 3100`.
- Окно не закрывается само; при ошибке — `pause` и понятный текст.
- Сервер сам печатает баннер: версия, локальный URL, **все LAN-IPv4** (`http://192.168.1.10:8103`), путь к БД, порт.
- Порт занят и `autoPort: true` → следующий свободный, напечатать фактический.
- Ctrl+C — корректное завершение (закрыть сокеты, дождаться записи в БД).

## 4. build-archive.ps1 (обёртка build-archive.bat)

Порядок, падение на любой ошибке:

1. Проверить Node/npm на машине сборки.
2. `npm ci` (если нет lock — `npm install` и зафиксировать).
3. `npm run verify` — typecheck + lint + unit + integration. **Упали тесты → архива нет.**
4. `npm run build` — tsc сервера + vite фронтенда.
5. Собрать staging `release/<name>-v<version>/` по структуре из п. 2.
6. `npm prune --omit=dev`; убедиться, что нет dev-зависимостей и нативных `.node`.
7. Скачать LTS win-x64 Node через `https://nodejs.org/dist/index.json` с кэшем в `.cache/`, распаковать в `runtime/node/`, проверить `node --version`.
8. Скопировать `config.json` (из `config.example.json`), `README.txt`, `VERSION.txt`.
9. По умолчанию включить текущую `data/app.db`; флаг `-NoData` исключает. Всегда исключать `data/logs/` и `data/backups/`.
10. `Compress-Archive` → `release/quiz-arena-v<version>-<yyyyMMdd-HHmm>.zip`; проверить размер и отсутствие симлинков.
11. Напечатать путь, размер, подсказку про перенос.

`scripts/fetch-portable-node.ps1` — отдельный скрипт только для скачивания/распаковки Node (кэш + проверка версии), переиспользуется сборкой и `test-portable.ps1`.

## 5. test-portable.ps1 — доказательство переносимости

1. Распаковать ZIP во временную папку.
2. Запустить `start.bat --no-open --port <свободный>` в фоне, **урезав PATH** до `C:\Windows\System32;C:\Windows` (имитация машины без Node).
3. Дождаться `GET /api/health` → 200; проверить `data/app.db`, `GET /api/board`, `GET /api/history` → 200.
4. Проверить, что в консоли напечатан LAN-URL.
5. Убить процесс вместе с дочерними, удалить temp, вернуть статус.
6. Флаг `-Skip` для вызова из сборки.

Скрипт запускается вручную и описан в README и `docs/TESTING.md`.

## 6. Подводные камни

| Проблема | Решение |
|---|---|
| Кириллица в консоли — кракозябры | `chcp 65001`, файлы в UTF-8 |
| Путь с пробелами | всегда `"%~dp0..."` в кавычках, `cd /d` |
| Абсолютные пути разработчика в артефактах | конфиг и пути только относительные/через `%~dp0` |
| Нативные `.node` в node_modules | запрещены; использовать `node:sqlite`, а не `better-sqlite3` |
| `data/` внутри `app/` | вынести наружу, иначе обновление затирает историю |
| Firewall при первом старте | описать в README: разрешить для частных сетей |
| Антивирус ругается на неподписанный `node.exe` | описать: добавить папку в исключения |
| Windows Defender SmartScreen | описать: «Подробнее → Выполнить всё равно» |
| Обновление на целевой машине | заменить `app/` и `runtime/`, сохранить `data/` и `config.json` |

## 7. Запрещено

- ❌ Требовать установку Node.js/npm на целевой машине.
- ❌ `npm install` при запуске и любые сетевые запросы при старте.
- ❌ Docker, службы Windows, запись в `Program Files`, права администратора.
- ❌ Зависеть от версии Node на машине сборки: версия фиксируется `.node-version` и `VERSION.txt`.

## 8. Проверка перед сдачей

```powershell
npm run verify
npm run build
.\build-archive.bat
powershell -ExecutionPolicy Bypass -File .\scripts\test-portable.ps1 -Zip .\release\quiz-arena-v1.0.0-*.zip
```

Плюс вручную: распаковать в `C:\Temp\Тест Игры\`, запустить `start.bat`, открыть с телефона в той же Wi-Fi.
