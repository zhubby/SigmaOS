import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HostdClient, HostdRequestError } from "./hostd-client.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("HostdClient", () => {
  it("sends one versioned JSONL request and validates the response id", async () => {
    const { client, close } = await createServer((request) => ({
      version: 1,
      id: request.id,
      ok: true,
      result: { ready: true }
    }));
    await expect(client.request("network.manager", { action: "ping" }, 1000)).resolves.toEqual({ ready: true });
    await close();
  });

  it("preserves structured hostd errors", async () => {
    const { client, close } = await createServer((request) => ({
      version: 1,
      id: request.id,
      ok: false,
      error: { status: 409, code: "conflict", message: "stale", rollback: "failed" }
    }));
    await expect(client.request("network.manager", {}, 1000)).rejects.toMatchObject({
      statusCode: 409,
      code: "conflict",
      details: { rollback: "failed" }
    } satisfies Partial<HostdRequestError>);
    await close();
  });

  it("rejects mismatched response ids", async () => {
    const { client, close } = await createServer(() => ({
      version: 1,
      id: "67e55044-10b1-426f-9247-bb680e5fe0c8",
      ok: true,
      result: {}
    }));
    await expect(client.request("shares.apply", {}, 1000)).rejects.toMatchObject({ code: "protocol_error" });
    await close();
  });

  it("rejects requests and responses that exceed the frame limit", async () => {
    const oversizedPayload = { value: "x".repeat(1024 * 1024) };
    await expect(new HostdClient("/unused").request("shares.apply", oversizedPayload, 1000)).rejects.toMatchObject({
      statusCode: 413,
      code: "protocol_error"
    });

    const { client, close } = await createRawServer((socket) => {
      socket.on("data", () => undefined);
      socket.on("end", () => socket.end(Buffer.alloc(1024 * 1024 + 2, "x")));
    });
    await expect(client.request("shares.apply", {}, 1000)).rejects.toMatchObject({
      statusCode: 502,
      code: "output_too_large"
    });
    await close();
  });

  it("rejects multiple response frames", async () => {
    const { client, close } = await createRawServer((socket) => {
      socket.on("data", () => undefined);
      socket.on("end", () => socket.end("{}\n{}\n"));
    });
    await expect(client.request("shares.apply", {}, 1000)).rejects.toMatchObject({ code: "protocol_error" });
    await close();
  });

  it("times out stalled requests and preserves socket error codes", async () => {
    const stalled = await createRawServer((socket) => {
      socket.on("error", () => undefined);
      socket.resume();
      setTimeout(() => socket.destroy(), 200);
    });
    await expect(stalled.client.request("shares.apply", {}, 50)).rejects.toMatchObject({
      statusCode: 504,
      code: "timeout"
    });
    await stalled.close();

    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-hostd-client-missing-"));
    const missingSocket = path.join(tempDir, "missing.sock");
    await expect(new HostdClient(missingSocket).request("shares.apply", {}, 1000)).rejects.toMatchObject({
      statusCode: 503,
      code: "unavailable",
      socketCode: "ENOENT"
    });
  });
});

async function createServer(
  respond: (request: Record<string, unknown>) => Record<string, unknown>
): Promise<{ client: HostdClient; close: () => Promise<void> }> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-hostd-client-"));
  const socketPath = path.join(tempDir, "hostd.sock");
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      socket.end(`${JSON.stringify(respond(request))}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    client: new HostdClient(socketPath),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function createRawServer(
  onConnection: (socket: net.Socket) => void
): Promise<{ client: HostdClient; close: () => Promise<void> }> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-hostd-client-"));
  const socketPath = path.join(tempDir, "hostd.sock");
  const server = net.createServer({ allowHalfOpen: true }, onConnection);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    client: new HostdClient(socketPath),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
