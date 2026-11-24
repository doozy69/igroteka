import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { createHistory } from "./history.js";
import { lanAddresses } from "./util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VERSION = "1.0.0";

const DEFAULTS = {
  port: 8103,
  maxPlayers: 12,
  autoOpenBrowser: true,
  autoPort: true,
  historyLimit: 200,
  historyFile: path.join("data", "history.json"),
};

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") result.port = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith("--port=")) result.port = Number.parseInt(arg.slice(7), 10);
    else if (arg === "--no-open") result.autoOpenBrowser = false;
    else if (arg === "--no-auto-port") result.autoPort = false;
    else if (arg === "--history") result.historyFile = argv[++i];
    else if (arg.startsWith("--history=")) result.historyFile = arg.slice(10);
  }
  return result;
}

async function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[config] не удалось прочитать config.json: ${error.message}`);
    }
  }

  const env = {
    ...(process.env.PORT ? { port: Number.parseInt(process.env.PORT, 10) } : {}),
    ...(process.env.MAX_PLAYERS ? { maxPlayers: Number.parseInt(process.env.MAX_PLAYERS, 10) } : {}),
    ...(process.env.AUTO_OPEN === "false" ? { autoOpenBrowser: false } : {}),
    ...(process.env.HISTORY_FILE ? { historyFile: process.env.HISTORY_FILE } : {}),
  };

  return { ...DEFAULTS, ...fileConfig, ...env, ...parseArgs(process.argv.slice(2)) };
}

function lanUrls(port) {
  return lanAddresses().map((ip) => `http://${ip}:${port}`);
}

async function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address().port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function main() {
  const config = await loadConfig();
  config.version = VERSION;
  const historyFile = path.resolve(ROOT, config.historyFile ?? DEFAULTS.historyFile);
  const history = await createHistory({
    file: historyFile,
    limit: Number.isFinite(config.historyLimit) ? config.historyLimit : DEFAULTS.historyLimit,
  });

  const { httpServer, close } = await createApp({ config, history });

  let port = Number.isFinite(config.port) ? config.port : DEFAULTS.port;
  const attempts = config.autoPort ? 20 : 1;
  let actualPort = null;
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      actualPort = await listen(httpServer, port + i, "0.0.0.0");
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") break;
    }
  }

  if (actualPort === null) {
    console.error(
      lastError?.code === "EADDRINUSE"
        ? `[ERROR] порт ${port} занят, свободных портов рядом нет`
        : `[ERROR] не удалось запустить сервер: ${lastError?.message}`,
    );
    process.exitCode = 1;
    return;
  }

  const localUrl = `http://localhost:${actualPort}`;
  config.actualPort = actualPort;
  console.log("");
  console.log(`  Кто быстрее v${VERSION}`);
  console.log(`  Локально:  ${localUrl}`);
  const urls = lanUrls(actualPort);
  if (urls.length > 0) {
    console.log(`  Телефоны:  ${urls.join("  ")}`);
  } else {
    console.log("  Телефоны:  интерфейс локальной сети не найден");
  }
  console.log(`  История:   ${historyFile}`);
  console.log("  Ctrl+C — остановить");
  console.log("");

  if (config.autoOpenBrowser) {
    const cmd =
      process.platform === "win32"
        ? `start "" "${localUrl}"`
        : process.platform === "darwin"
          ? `open "${localUrl}"`
          : `xdg-open "${localUrl}"`;
    exec(cmd, () => {});
  }

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n  ${signal}: останавливаем сервер…`);
    await close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`[ERROR] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
