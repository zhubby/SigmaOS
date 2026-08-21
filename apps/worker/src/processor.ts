import { runReadOnlyAgentTurn } from "@sigmaos/agent";
import {
  appendEvent,
  claimNextJob,
  createPendingApproval,
  getJob,
  getMessage,
  getNasRoot,
  getSession,
  queryIndexedText,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";

export interface ProcessNextJobDependencies {
  db: SigmaDatabase;
}

export async function processNextJob({ db }: ProcessNextJobDependencies): Promise<boolean> {
  const job = claimNextJob(db);
  if (!job) {
    return false;
  }

  const session = getSession(db, job.sessionId);
  const message = getMessage(db, job.messageId);
  const root = session ? getNasRoot(db, session.rootId) : null;

  if (!session || !message || !root) {
    const error = "Job references missing session, message, or NAS root";
    const failed = updateJobStatus(db, job.id, "failed", error, ["running"]);
    if (failed && session) {
      appendEvent(db, {
        sessionId: session.id,
        jobId: job.id,
        type: "job.failed",
        payload: { error }
      });
    }
    return true;
  }

  appendEvent(db, {
    sessionId: session.id,
    jobId: job.id,
    type: "job.running",
    payload: {
      jobId: job.id
    }
  });

  try {
    const result = await runReadOnlyAgentTurn({
      session,
      root,
      message: message.content,
      emit: (event) => {
        appendEvent(db, {
          sessionId: session.id,
          jobId: job.id,
          type: event.type,
          payload: event.payload
        });
      },
      isCancelled: () => getJob(db, job.id)?.status === "cancelled",
      queryIndex: async (query) => {
        try {
          return queryIndexedText(db, {
            rootId: root.id,
            query,
            limit: 25
          });
        } catch {
          return [];
        }
      },
      proposeChanges: async (proposal) => {
        return createPendingApproval(db, {
          jobId: job.id,
          proposal
        });
      }
    });

    if (result.status === "cancelled" || getJob(db, job.id)?.status === "cancelled") {
      return true;
    }

    if (result.status === "failed") {
      const error = result.error ?? "Agent turn failed";
      if (updateJobStatus(db, job.id, "failed", error, ["running"])) {
        appendEvent(db, {
          sessionId: session.id,
          jobId: job.id,
          type: "job.failed",
          payload: {
            error
          }
        });
      }
      return true;
    }

    if (result.status === "waiting_approval") {
      updateJobStatus(db, job.id, "waiting_approval", null, ["running"]);
      return true;
    }

    if (!updateJobStatus(db, job.id, "completed", null, ["running"])) {
      return true;
    }
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "job.completed",
      payload: {
        jobId: job.id
      }
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (updateJobStatus(db, job.id, "failed", messageText, ["running"])) {
      appendEvent(db, {
        sessionId: session.id,
        jobId: job.id,
        type: "job.failed",
        payload: {
          error: messageText
        }
      });
    }
  }

  return true;
}
