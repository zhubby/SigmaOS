import { execFile } from "node:child_process";
import { chmod, chown, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { ShareApplyRequest } from "@sigmaos/shared";
import { applyHostShareSettings, safeShareHelperMessage } from "./helper.js";

const SOCKET_PATH = process.env.SIGMAOS_SHARE_HELPER_SOCKET_PATH ?? "/run/sigmaos/share-helper.sock";
const SOCKET_GROUP = process.env.SIGMAOS_SHARE_HELPER_GROUP ?? "sigmaos";
const MAX_BODY_BYTES = 1024 * 1024;

const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/apply") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await applyHostShareSettings(body as ShareApplyRequest);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: safeShareHelperMessage(error)
    });
  }
});

await listenOnSocket(server, SOCKET_PATH, SOCKET_GROUP);

process.on("SIGTERM", () => closeServer());
process.on("SIGINT", () => closeServer());

async function listenOnSocket(instance: http.Server, socketPath: string, group: string): Promise<void> {
  await mkdir(path.dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(socketPath, () => {
      instance.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o660);
  try {
    await chown(socketPath, 0, await groupId(group));
  } catch {
    // Package installs create the sigmaos group. Dev shells can run without it.
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function closeServer(): void {
  server.close(() => {
    process.exit(0);
  });
}

function groupId(group: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile("getent", ["group", group], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const gid = Number(stdout.trim().split(":")[2]);
      if (!Number.isInteger(gid)) {
        reject(new Error(`Group ${group} has no numeric gid`));
        return;
      }
      resolve(gid);
    });
  });
}
