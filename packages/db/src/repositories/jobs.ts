import { randomUUID } from "node:crypto";
import type {
  AgentEventRecord,
  AgentEventType,
  AgentMessageRecord,
  JobRecord,
  JobStatus
} from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { mapEvent, mapJob, mapMessage } from "./agent-mappers.js";
import type { DbEventRow, DbJobRow, DbMessageRow } from "./repository-rows.js";

export function createUserMessageAndJob(
  db: SigmaDatabase,
  input: { sessionId: string; content: string; status?: JobStatus }
): { message: AgentMessageRecord; job: JobRecord } {
  const now = new Date().toISOString();
  const message: AgentMessageRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: "user",
    content: input.content,
    createdAt: now
  };
  const job: JobRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: message.id,
    status: input.status ?? "queued",
    createdAt: now,
    updatedAt: now,
    error: null
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_messages (id, session_id, role, content, created_at)
      VALUES (@id, @sessionId, @role, @content, @createdAt)
    `).run(message);
    db.prepare(`
      INSERT INTO jobs (id, session_id, message_id, status, error, created_at, updated_at)
      VALUES (@id, @sessionId, @messageId, @status, @error, @createdAt, @updatedAt)
    `).run(job);
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run(now, input.sessionId);
  });

  tx();
  return { message, job };
}

export function getMessage(db: SigmaDatabase, messageId: string): AgentMessageRecord | null {
  const row = db
    .prepare("SELECT id, session_id, role, content, created_at FROM agent_messages WHERE id = ?")
    .get(messageId) as DbMessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function getJob(db: SigmaDatabase, jobId: string): JobRecord | null {
  const row = db
    .prepare("SELECT id, session_id, message_id, status, created_at, updated_at, error FROM jobs WHERE id = ?")
    .get(jobId) as DbJobRow | undefined;
  return row ? mapJob(row) : null;
}

export function claimNextJob(db: SigmaDatabase): JobRecord | null {
  const now = new Date().toISOString();
  const row = db
    .prepare(`
      UPDATE jobs
      SET status = 'running', error = NULL, updated_at = ?
      WHERE id = (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      )
      AND status = 'queued'
      RETURNING id, session_id, message_id, status, created_at, updated_at, error
    `)
    .get(now) as DbJobRow | undefined;

  return row ? mapJob(row) : null;
}

export function updateJobStatus(
  db: SigmaDatabase,
  jobId: string,
  status: JobStatus,
  error: string | null = null,
  allowedFrom?: JobStatus[]
): boolean {
  const params: Array<string | null> = [status, error, new Date().toISOString(), jobId];
  const statusGuard = allowedFrom?.length
    ? ` AND status IN (${allowedFrom.map(() => "?").join(", ")})`
    : "";

  if (allowedFrom?.length) {
    params.push(...allowedFrom);
  }

  const result = db
    .prepare(`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?${statusGuard}`)
    .run(...params);
  return result.changes === 1;
}

export function appendEvent<TPayload>(
  db: SigmaDatabase,
  input: {
    sessionId: string;
    jobId?: string | null;
    type: AgentEventType;
    payload: TPayload;
  }
): AgentEventRecord<TPayload> {
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO agent_events (session_id, job_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(input.sessionId, input.jobId ?? null, input.type, JSON.stringify(input.payload), createdAt);

  return {
    id: Number(result.lastInsertRowid),
    sessionId: input.sessionId,
    jobId: input.jobId ?? null,
    type: input.type,
    payload: input.payload,
    createdAt
  };
}

export function listEvents(
  db: SigmaDatabase,
  input: { sessionId: string; afterId?: number; limit?: number }
): AgentEventRecord[] {
  const rows = db
    .prepare(`
      SELECT id, session_id, job_id, type, payload_json, created_at
      FROM agent_events
      WHERE session_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(input.sessionId, input.afterId ?? 0, input.limit ?? 100) as DbEventRow[];

  return rows.map(mapEvent);
}
