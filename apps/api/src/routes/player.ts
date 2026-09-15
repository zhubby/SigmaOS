import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { inferMimeType, inferPreviewKind } from "@sigmaos/nas-tools";
import type { PlayerCommand, PlayerErrorCode } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { createPlayerRuntime, PlayerRuntimeError, type PlayerRuntime } from "../lib/player.js";
import { resolveScopedExistingPath, resolveStoragePoolScope } from "../lib/storage-scope.js";

type PlayerCommandBody =
  | {
      type: "play";
      rootId?: string;
      storagePoolId?: string;
      path?: string;
      startPositionSeconds?: number;
    }
  | { type: "pause" | "resume" | "stop" }
  | { type: "seek"; seconds?: number }
  | { type: "set_volume"; volume?: number };

export function registerPlayerRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const runtime: PlayerRuntime = context.player ?? createPlayerRuntime(context.config.player);

  server.get("/api/player/status", async (_request, reply) => {
    try {
      reply.send({ status: await runtime.getStatus() });
    } catch (error) {
      sendPlayerError(reply, error);
    }
  });

  server.post<{ Body: PlayerCommandBody }>("/api/player/command", async (request, reply) => {
    try {
      const command = await buildCommand(request.body, context);
      reply.send({ status: await runtime.command(command) });
    } catch (error) {
      sendPlayerError(reply, error);
    }
  });
}

async function buildCommand(body: PlayerCommandBody | undefined, context: ApiRouteContext): Promise<PlayerCommand> {
  if (!body || typeof body.type !== "string") {
    throw new PlayerRuntimeError("Player command is required", 400, "INVALID_COMMAND");
  }
  if (body.type === "play") {
    if (
      typeof body.rootId !== "string" ||
      typeof body.storagePoolId !== "string" ||
      typeof body.path !== "string" ||
      !body.rootId.trim() ||
      !body.storagePoolId.trim() ||
      !body.path
    ) {
      throw new PlayerRuntimeError("A root, storage pool, and path are required", 400, "INVALID_PATH");
    }
    if (body.startPositionSeconds !== undefined && (!Number.isFinite(body.startPositionSeconds) || body.startPositionSeconds < 0)) {
      throw new PlayerRuntimeError("Start position must be a non-negative number", 400, "INVALID_COMMAND");
    }
    const scope = await resolveStoragePoolScope(context.db, context.system, body.rootId, body.storagePoolId);
    const safe = await resolveScopedExistingPath(scope, body.path);
    const fileStat = await stat(safe.realPath);
    if (!fileStat.isFile()) {
      throw new PlayerRuntimeError("Selected path is not a file", 400, "INVALID_PATH");
    }
    if (inferPreviewKind(inferMimeType(safe.realPath)) !== "video") {
      throw new PlayerRuntimeError("Selected file is not video-previewable", 415, "INVALID_PATH");
    }
    return {
      type: "play",
      path: safe.realPath,
      rootId: scope.root.id,
      storagePoolId: scope.pool.id,
      relativePath: safe.relativePath,
      ...(body.startPositionSeconds !== undefined ? { startPositionSeconds: body.startPositionSeconds } : {})
    };
  }
  if (body.type === "pause" || body.type === "resume" || body.type === "stop") {
    return { type: body.type };
  }
  if (body.type === "seek") {
    if (typeof body.seconds !== "number" || !Number.isFinite(body.seconds) || body.seconds < 0) {
      throw new PlayerRuntimeError("Seek position must be a non-negative number", 400, "INVALID_COMMAND");
    }
    return { type: "seek", seconds: body.seconds };
  }
  if (body.type !== "set_volume") {
    throw new PlayerRuntimeError("Unsupported player command", 400, "INVALID_COMMAND");
  }
  if (typeof body.volume !== "number" || !Number.isFinite(body.volume) || body.volume < 0 || body.volume > 100) {
    throw new PlayerRuntimeError("Volume must be between 0 and 100", 400, "INVALID_COMMAND");
  }
  return { type: "set_volume", volume: body.volume };
}

function sendPlayerError(reply: { status(code: number): { send(payload: unknown): void } }, error: unknown): void {
  const statusCode = error instanceof PlayerRuntimeError
    ? error.statusCode
    : typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : "HDMI player request failed";
  const code: PlayerErrorCode = error instanceof PlayerRuntimeError
    ? error.code
    : statusCode >= 400 && statusCode < 500
      ? "INVALID_PATH"
      : "INTERNAL";
  reply.status(statusCode).send({ error: message, code });
}
