import { describe, expect, it } from "vitest";
import { eventToTranscriptMessage } from "./events.js";
import type { AgentEvent } from "../api.js";

describe("event helpers", () => {
  it("converts non-empty agent messages into transcript messages", () => {
    const event: AgentEvent = {
      id: 42,
      type: "agent.message",
      payload: { content: "Done" },
      createdAt: "2026-08-21T00:00:00.000Z"
    };

    expect(eventToTranscriptMessage(event)).toEqual({
      id: "event:42",
      role: "assistant",
      content: "Done",
      createdAt: "2026-08-21T00:00:00.000Z"
    });
  });

  it("ignores non-message events and empty message payloads", () => {
    expect(
      eventToTranscriptMessage({
        id: 1,
        type: "job.running",
        payload: { content: "ignored" },
        createdAt: "2026-08-21T00:00:00.000Z"
      })
    ).toBeNull();
    expect(
      eventToTranscriptMessage({
        id: 2,
        type: "agent.message",
        payload: { content: "" },
        createdAt: "2026-08-21T00:00:00.000Z"
      })
    ).toBeNull();
    expect(
      eventToTranscriptMessage({
        id: 3,
        type: "agent.message",
        payload: { content: null },
        createdAt: "2026-08-21T00:00:00.000Z"
      })
    ).toBeNull();
  });
});
