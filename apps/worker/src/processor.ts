import { runPiAgentTurn, runReadOnlyAgentTurn, type PiAgentRunner } from "@sigmaos/agent";
import {
  appendEvent,
  claimNextJob,
  createPendingApproval,
  createPiToolCallApproval,
  defaultPiToolPolicySettings,
  getAgentProviderSession,
  getApproval,
  getJob,
  getMessage,
  getModelProviderSettings,
  getNasRoot,
  getPiToolPolicySettings,
  getSession,
  queryIndexedText,
  saveAgentProviderSession,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";
import type { ModelProviderSettingsRecord, SigmaConfig } from "@sigmaos/shared";

export interface ProcessNextJobDependencies {
  db: SigmaDatabase;
  config: SigmaConfig;
  agentRunner?: PiAgentRunner;
  allowLocalFallback?: boolean;
}

export async function processNextJob({ db, config, agentRunner, allowLocalFallback }: ProcessNextJobDependencies): Promise<boolean> {
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
    const shouldUseLocalFallback =
      allowLocalFallback === true || process.env.SIGMAOS_ENABLE_LOCAL_AGENT_FALLBACK === "1";
    const result = shouldUseLocalFallback
      ? await runReadOnlyAgentTurn({
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
        })
      : await runPiAgentTurn({
          session,
          root,
          message: message.content,
          dataDir: config.dataDir,
          modelSettings: getModelProviderSettings(db) ?? defaultModelProviderSettings(config),
          toolPolicy: getPiToolPolicySettings(db) ?? defaultPiToolPolicySettings(),
          providerSession: getAgentProviderSession(db, session.id),
          ...(agentRunner ? { runner: agentRunner } : {}),
          emit: (event) => {
            appendEvent(db, {
              sessionId: session.id,
              jobId: job.id,
              type: event.type,
              payload: event.payload
            });
          },
          isCancelled: () => getJob(db, job.id)?.status === "cancelled",
          saveProviderSession: (providerSession) => {
            saveAgentProviderSession(db, {
              sessionId: session.id,
              providerSessionId: providerSession.providerSessionId,
              sessionFile: providerSession.sessionFile,
              providerName: providerSession.providerName,
              model: providerSession.model,
              settingsSnapshot: providerSession.settingsSnapshot
            });
          },
          createToolApproval: async (proposal) =>
            createPiToolCallApproval(db, {
              jobId: job.id,
              proposal
            }),
          getApprovalStatus: (approvalId) => getApproval(db, approvalId)?.status ?? null,
          markWaitingForApproval: () => {
            updateJobStatus(db, job.id, "waiting_approval", null, ["running"]);
          }
        });

    if (result.status === "cancelled" || getJob(db, job.id)?.status === "cancelled") {
      return true;
    }

    if (result.status === "failed") {
      const error = result.error ?? "Agent turn failed";
      if (updateJobStatus(db, job.id, "failed", error, ["running", "waiting_approval"])) {
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

    if (!updateJobStatus(db, job.id, "completed", null, ["running", "waiting_approval"])) {
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
    if (updateJobStatus(db, job.id, "failed", messageText, ["running", "waiting_approval"])) {
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

function defaultModelProviderSettings(config: SigmaConfig): ModelProviderSettingsRecord {
  return {
    providerName: "openai",
    baseUrl: config.model.localEndpoint,
    model: "",
    apiKey: null,
    updatedAt: new Date(0).toISOString()
  };
}
