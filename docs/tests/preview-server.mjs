import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const mime = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

const server = http.createServer(async (request, response) => {
  try {
    const requested = new globalThis.URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (!requested.startsWith("/docs")) {
      response.writeHead(404).end();
      return;
    }

    const relative = requested.slice("/docs".length).replace(/^\//, "") || "index.html";
    const candidate = path.resolve(dist, relative);
    if (!candidate.startsWith(`${dist}${path.sep}`) && candidate !== dist) {
      response.writeHead(400).end();
      return;
    }

    let filePath = candidate;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      if (!path.extname(filePath)) filePath = path.join(filePath, "index.html");
    }
    await access(filePath);
    response.writeHead(200, { "content-type": mime[path.extname(filePath)] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4321, "127.0.0.1");
