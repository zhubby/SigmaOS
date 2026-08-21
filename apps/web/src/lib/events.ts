import type { AgentEvent, TranscriptMessage } from "../api.js";

export function eventToTranscriptMessage(event: AgentEvent): TranscriptMessage | null {
  if (event.type !== "agent.message") {
    return null;
  }
  const content = typeof event.payload.content === "string" ? event.payload.content : "";
  if (!content) {
    return null;
  }
  return {
    id: `event:${event.id}`,
    role: "assistant",
    content,
    createdAt: event.createdAt
  };
}

export function getEventJobId(event: AgentEvent): string | null {
  return typeof event.payload.jobId === "string" ? event.payload.jobId : null;
}
