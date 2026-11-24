// Static server for viewing mockups: node mockups/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] ?? 8899);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = normalize(join(root, raw === "/" ? "index.html" : raw));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`mockups: http://127.0.0.1:${port}/01-home.html`);
});
