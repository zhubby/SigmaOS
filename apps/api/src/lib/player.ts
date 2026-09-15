import { randomUUID } from "node:crypto";
import net from "node:net";
import {
  encodePlayerBrokerMessage,
  parsePlayerBrokerResponse,
  PLAYER_BROKER_CONNECT_TIMEOUT_MS,
  PLAYER_BROKER_MAX_FRAME_BYTES,
  type PlayerCommand,
  type PlayerConfig,
  type PlayerErrorCode,
  type PlayerStatus
} from "@sigmaos/shared";

export interface PlayerRuntime {
  getStatus(): Promise<PlayerStatus>;
  command(command: PlayerCommand): Promise<PlayerStatus>;
}

export class PlayerRuntimeError extends Error {
  readonly statusCode: number;
  readonly expose = true;
  readonly code: PlayerErrorCode;

  constructor(message: string, statusCode = 503, code: PlayerErrorCode = "HELPER_UNAVAILABLE") {
    super(message);
    this.name = "PlayerRuntimeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createPlayerRuntime(config: PlayerConfig): PlayerRuntime {
  return new UnixSocketPlayerRuntime(config);
}

class UnixSocketPlayerRuntime implements PlayerRuntime {
  constructor(private readonly config: PlayerConfig) {}

  async getStatus(): Promise<PlayerStatus> {
    if (!this.config.enabled) {
      return disabledStatus();
    }
    return this.request({ type: "status" });
  }

  async command(command: PlayerCommand): Promise<PlayerStatus> {
    if (!this.config.enabled) {
      throw new PlayerRuntimeError("HDMI player is disabled", 503, "PLAYER_DISABLED");
    }
    return this.request(command);
  }

  private request(command: PlayerCommand | { type: "status" }): Promise<PlayerStatus> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: this.config.helperSocketPath });
      let buffer = "";
      let settled = false;
      const timeout = setTimeout(() => {
        finish(new PlayerRuntimeError("HDMI player helper timed out"));
      }, PLAYER_BROKER_CONNECT_TIMEOUT_MS);
      timeout.unref?.();

      const finish = (error?: Error, status?: PlayerStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else if (status) resolve(status);
        else reject(new PlayerRuntimeError("HDMI player returned no status"));
      };

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(encodePlayerBrokerMessage({ id, command }));
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > PLAYER_BROKER_MAX_FRAME_BYTES && !buffer.includes("\n")) {
          finish(new PlayerRuntimeError("HDMI player response is too large", 502));
          return;
        }
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const frame = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const response = parsePlayerBrokerResponse(frame);
          if (!response || response.id !== id) {
            finish(new PlayerRuntimeError("Invalid response from HDMI player", 502));
            return;
          }
          if (!response.ok) {
            finish(new PlayerRuntimeError(response.error, response.statusCode ?? 503, response.code ?? "HELPER_UNAVAILABLE"));
          } else {
            finish(undefined, response.status);
          }
          newlineIndex = buffer.indexOf("\n");
        }
      });
      socket.on("error", (error) => {
        finish(new PlayerRuntimeError(playerSocketError(error)));
      });
      socket.on("close", () => {
        if (!settled) finish(new PlayerRuntimeError("HDMI player helper is unavailable"));
      });
    });
  }
}

function disabledStatus(): PlayerStatus {
  return {
    state: "idle",
    rootId: null,
    storagePoolId: null,
    relativePath: null,
    fileName: null,
    positionSeconds: 0,
    durationSeconds: null,
    volume: 100,
    capabilities: {
      mpvAvailable: false,
      drmAvailable: false,
      audioAvailable: false,
      hardwareDecode: "unknown",
      error: "HDMI player is disabled"
    },
    error: "HDMI player is disabled",
    errorCode: "PLAYER_DISABLED",
    updatedAt: new Date().toISOString()
  };
}

function playerSocketError(error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
    return "HDMI player helper is unavailable";
  }
  return error.message || "HDMI player helper connection failed";
}
