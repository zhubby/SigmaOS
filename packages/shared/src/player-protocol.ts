export const PLAYER_BROKER_MAX_FRAME_BYTES = 128 * 1024;
export const PLAYER_BROKER_CONNECT_TIMEOUT_MS = 5_000;

export type PlayerState = "idle" | "starting" | "playing" | "paused" | "stopped" | "error";

export type PlayerErrorCode =
  | "PLAYER_DISABLED"
  | "HELPER_UNAVAILABLE"
  | "MPV_UNAVAILABLE"
  | "DRM_UNAVAILABLE"
  | "AUDIO_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "PLAYBACK_FAILED"
  | "PLAYER_BUSY"
  | "INVALID_COMMAND"
  | "INVALID_PATH"
  | "INTERNAL";

export interface PlayerCapabilities {
  mpvAvailable: boolean;
  drmAvailable: boolean;
  audioAvailable: boolean;
  hardwareDecode: "enabled" | "software" | "unknown";
  error: string | null;
}

export interface PlayerStatus {
  state: PlayerState;
  rootId: string | null;
  storagePoolId: string | null;
  relativePath: string | null;
  fileName: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  volume: number;
  capabilities: PlayerCapabilities;
  error: string | null;
  errorCode?: PlayerErrorCode | null;
  updatedAt: string;
}

export type PlayerCommand =
  | {
      type: "play";
      path: string;
      rootId: string;
      storagePoolId: string;
      relativePath: string;
      startPositionSeconds?: number;
    }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "seek"; seconds: number }
  | { type: "set_volume"; volume: number };

export type PlayerBrokerRequest = { id: string; command: PlayerCommand | { type: "status" } };

export type PlayerBrokerResponse =
  | { id: string; ok: true; status: PlayerStatus }
  | {
      id: string;
      ok: false;
      error: string;
      code?: PlayerErrorCode;
      statusCode?: number;
    };

export function encodePlayerBrokerMessage(message: PlayerBrokerRequest | PlayerBrokerResponse): string {
  return `${JSON.stringify(message)}\n`;
}

export function parsePlayerBrokerRequest(raw: string): PlayerBrokerRequest | null {
  const value = parseJsonRecord(raw);
  if (!value || typeof value.id !== "string" || !isSafeId(value.id) || !isRecord(value.command)) {
    return null;
  }

  const command = value.command;
  if (command.type === "status") {
    return { id: value.id, command: { type: "status" } };
  }
  if (typeof command.type !== "string") {
    return null;
  }
  if (command.type === "play") {
    if (
      typeof command.path !== "string" ||
      !command.path.startsWith("/") ||
      command.path.includes("\0") ||
      typeof command.rootId !== "string" ||
      typeof command.storagePoolId !== "string" ||
      !isSafeIdentifier(command.rootId) ||
      !isSafeIdentifier(command.storagePoolId) ||
      typeof command.relativePath !== "string" ||
      !isSafeRelativePath(command.relativePath)
    ) {
      return null;
    }
    const startPositionSeconds = optionalFiniteNonNegative(command.startPositionSeconds);
    if (command.startPositionSeconds !== undefined && startPositionSeconds === null) {
      return null;
    }
    return {
      id: value.id,
      command: {
        type: "play",
        path: command.path,
        rootId: command.rootId,
        storagePoolId: command.storagePoolId,
        relativePath: command.relativePath,
        ...(startPositionSeconds !== null ? { startPositionSeconds } : {})
      }
    };
  }
  if (command.type === "pause" || command.type === "resume" || command.type === "stop") {
    return { id: value.id, command: { type: command.type } };
  }
  if (command.type === "seek") {
    const seconds = finiteNonNegative(command.seconds);
    return seconds === null ? null : { id: value.id, command: { type: "seek", seconds } };
  }
  if (command.type === "set_volume") {
    const volume = finiteNumber(command.volume);
    return volume === null || volume < 0 || volume > 100
      ? null
      : { id: value.id, command: { type: "set_volume", volume } };
  }
  return null;
}

export function parsePlayerBrokerResponse(raw: string): PlayerBrokerResponse | null {
  const value = parseJsonRecord(raw);
  if (!value || typeof value.id !== "string" || !isSafeId(value.id) || typeof value.ok !== "boolean") {
    return null;
  }
  if (!value.ok) {
    if (typeof value.error !== "string" || value.error.length > 4096) {
      return null;
    }
    const statusCode = value.statusCode;
    if (statusCode !== undefined &&
      (typeof statusCode !== "number" || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599)) {
      return null;
    }
    const code = value.code;
    if (code !== undefined && !isPlayerErrorCode(code)) {
      return null;
    }
    return {
      id: value.id,
      ok: false,
      error: value.error,
      ...(code !== undefined ? { code } : {}),
      ...(statusCode !== undefined ? { statusCode } : {})
    };
  }
  const status = parsePlayerStatus(value.status);
  return status ? { id: value.id, ok: true, status } : null;
}

function parsePlayerStatus(value: unknown): PlayerStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = value.state;
  if (!isPlayerState(state)) {
    return null;
  }
  const positionSeconds = finiteNonNegative(value.positionSeconds);
  const durationSeconds = value.durationSeconds === null ? null : finiteNonNegative(value.durationSeconds);
  const volume = finiteNumber(value.volume);
  const capabilities = parseCapabilities(value.capabilities);
  const errorCode = value.errorCode === undefined || value.errorCode === null
    ? null
    : isPlayerErrorCode(value.errorCode)
      ? value.errorCode
      : null;
  if (
    typeof value.rootId !== "string" && value.rootId !== null ||
    typeof value.storagePoolId !== "string" && value.storagePoolId !== null ||
    typeof value.relativePath !== "string" && value.relativePath !== null ||
    typeof value.fileName !== "string" && value.fileName !== null ||
    positionSeconds === null ||
    (value.durationSeconds !== null && durationSeconds === null) ||
    volume === null || volume < 0 || volume > 100 ||
    !capabilities ||
    typeof value.error !== "string" && value.error !== null ||
    value.errorCode !== undefined && value.errorCode !== null && !isPlayerErrorCode(value.errorCode) ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    state,
    rootId: value.rootId,
    storagePoolId: value.storagePoolId,
    relativePath: value.relativePath,
    fileName: value.fileName,
    positionSeconds,
    durationSeconds,
    volume,
    capabilities,
    error: value.error,
    errorCode,
    updatedAt: value.updatedAt
  };
}

function parseCapabilities(value: unknown): PlayerCapabilities | null {
  if (!isRecord(value)) {
    return null;
  }
  const hardwareDecode = value.hardwareDecode;
  if (
    typeof value.mpvAvailable !== "boolean" ||
    typeof value.drmAvailable !== "boolean" ||
    typeof value.audioAvailable !== "boolean" ||
    (hardwareDecode !== "enabled" && hardwareDecode !== "software" && hardwareDecode !== "unknown") ||
    typeof value.error !== "string" && value.error !== null
  ) {
    return null;
  }
  return {
    mpvAvailable: value.mpvAvailable,
    drmAvailable: value.drmAvailable,
    audioAvailable: value.audioAvailable,
    hardwareDecode,
    error: value.error
  };
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  if (Buffer.byteLength(raw, "utf8") > PLAYER_BROKER_MAX_FRAME_BYTES) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

function isSafeIdentifier(value: string): boolean {
  return isSafeId(value) && !value.includes("\0");
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\0") || value.startsWith("/")) return false;
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}

function isPlayerState(value: unknown): value is PlayerState {
  return value === "idle" || value === "starting" || value === "playing" || value === "paused" || value === "stopped" || value === "error";
}

function isPlayerErrorCode(value: unknown): value is PlayerErrorCode {
  return value === "PLAYER_DISABLED" || value === "HELPER_UNAVAILABLE" || value === "MPV_UNAVAILABLE" ||
    value === "DRM_UNAVAILABLE" || value === "AUDIO_UNAVAILABLE" || value === "PERMISSION_DENIED" || value === "PLAYBACK_FAILED" ||
    value === "PLAYER_BUSY" || value === "INVALID_COMMAND" || value === "INVALID_PATH" || value === "INTERNAL";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function optionalFiniteNonNegative(value: unknown): number | null {
  return value === undefined ? null : finiteNonNegative(value);
}
