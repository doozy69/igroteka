import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * История матчей в JSON-файле.
 * Запись атомарная (tmp + rename), записи сериализованы, чтобы не потерять матчи.
 */
export async function createHistory({ file, limit = 200 }) {
  let matches = [];
  let writing = Promise.resolve();

  async function load() {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.matches)) {
        matches = parsed.matches.slice(0, limit);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`[history] не удалось прочитать ${file}: ${error.message}`);
      }
    }
  }

  async function persist() {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const body = JSON.stringify({ version: 1, matches }, null, 2);
    await writeFile(tmp, body, "utf8");
    await rename(tmp, file);
  }

  await load();

  return {
    file,

    async saveMatch(match) {
      if (matches.some((item) => item.id === match.id)) return false;
      matches = [match, ...matches].slice(0, limit);
      writing = writing.then(persist).catch((error) => {
        console.error(`[history] не удалось записать ${file}: ${error.message}`);
      });
      await writing;
      return true;
    },

    list({ limit: take = 20, offset = 0 } = {}) {
      return {
        total: matches.length,
        matches: matches.slice(offset, offset + take),
      };
    },

    get(id) {
      return matches.find((item) => item.id === id) ?? null;
    },
  };
}
