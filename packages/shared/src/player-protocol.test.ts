import { describe, expect, it } from "vitest";
import {
  encodePlayerBrokerMessage,
  parsePlayerBrokerRequest,
  parsePlayerBrokerResponse,
  type PlayerStatus
} from "./player-protocol.js";

const status: PlayerStatus = {
  state: "playing",
  rootId: "primary",
  storagePoolId: "/dev/md/media",
  relativePath: "movies/clip.mp4",
  fileName: "clip.mp4",
  positionSeconds: 12.5,
  durationSeconds: 90,
  volume: 80,
  capabilities: {
    mpvAvailable: true,
    drmAvailable: true,
    audioAvailable: true,
    hardwareDecode: "enabled",
    error: null
  },
  error: null,
  updatedAt: new Date().toISOString()
};

describe("player broker protocol", () => {
  it("round-trips a play request and status response", () => {
    const request = parsePlayerBrokerRequest(
      encodePlayerBrokerMessage({
        id: "request-1",
        command: {
          type: "play",
          path: "/srv/nas/movies/clip.mp4",
          rootId: "primary",
          storagePoolId: "/dev/md/media",
          relativePath: "movies/clip.mp4",
          startPositionSeconds: 4
        }
      }).trim()
    );
    expect(request).toEqual({
      id: "request-1",
      command: {
        type: "play",
        path: "/srv/nas/movies/clip.mp4",
        rootId: "primary",
        storagePoolId: "/dev/md/media",
        relativePath: "movies/clip.mp4",
        startPositionSeconds: 4
      }
    });

    const response = parsePlayerBrokerResponse(
      encodePlayerBrokerMessage({ id: "request-1", ok: true, status }).trim()
    );
    expect(response).toMatchObject({ id: "request-1", ok: true, status });
  });

  it("rejects unsafe paths, invalid volumes, and oversized frames", () => {
    expect(
      parsePlayerBrokerRequest(
        JSON.stringify({
          id: "request-1",
          command: {
            type: "play",
            path: "relative/video.mp4",
            rootId: "primary",
            storagePoolId: "pool",
            relativePath: "video.mp4"
          }
        })
      )
    ).toBeNull();
    expect(parsePlayerBrokerRequest(JSON.stringify({ id: "request-1", command: { type: "set_volume", volume: 101 } }))).toBeNull();
    expect(parsePlayerBrokerRequest(JSON.stringify({
      id: "request-1",
      command: {
        type: "play",
        path: "/srv/nas/video.mp4",
        rootId: "primary",
        storagePoolId: "pool",
        relativePath: "../video.mp4"
      }
    }))).toBeNull();
    expect(parsePlayerBrokerRequest("x".repeat(128 * 1024 + 1))).toBeNull();
    expect(parsePlayerBrokerRequest(JSON.stringify({ id: "request-1", command: { type: "seek", seconds: -1 } }))).toBeNull();
  });

  it("round-trips structured helper errors", () => {
    expect(parsePlayerBrokerResponse(JSON.stringify({
      id: "request-1",
      ok: false,
      error: "Player is not paused",
      code: "PLAYER_BUSY",
      statusCode: 409
    }))).toEqual({
      id: "request-1",
      ok: false,
      error: "Player is not paused",
      code: "PLAYER_BUSY",
      statusCode: 409
    });
  });
});
