import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createShareOperationApproval,
  createUserMessageAndJob,
  getSession,
  getShareSettings,
  listNasRoots
} from "@sigmaos/db";
import type { ShareOperationProposal } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { normalizeShareSettingsInput, type ShareSettingsInput } from "../lib/share-settings.js";
import {
  collectShareSummary,
  safeShareMessage,
  toPublicShareOperation
} from "../lib/share-service.js";
import { defaultShareSettings, toPublicShareSettings } from "../lib/settings.js";

export function registerShareRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const { config, db } = context;

  server.get("/api/shares/summary", async () => {
    const settings = getShareSettings(db) ?? defaultShareSettings(config);
    return {
      summary: await collectShareSummary(settings, context.shares)
    };
  });

  server.post<{
    Body: {
      sessionId?: string;
      settings?: ShareSettingsInput;
    };
  }>("/api/shares/proposals", async (request, reply) => {
    const session = getSession(db, request.body?.sessionId ?? "");
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    const existing = getShareSettings(db) ?? defaultShareSettings(config);
    const roots = listNasRoots(db);
    try {
      const settings = await normalizeShareSettingsInput(request.body?.settings, existing, roots);
      const publicSettings = toPublicShareSettings(settings);
      const proposal: ShareOperationProposal = {
        action: "apply_settings",
        risk: "high",
        summary: shareProposalSummary(settings),
        settings: publicSettings
      };
      const { message, job } = createUserMessageAndJob(db, {
        sessionId: session.id,
        content: proposal.summary,
        status: "waiting_approval"
      });
      const { approval, operation } = createShareOperationApproval(db, {
        jobId: job.id,
        proposal,
        settings
      });
      appendEvent(db, {
        sessionId: session.id,
        jobId: job.id,
        type: "approval.pending",
        payload: {
          approvalId: approval.id,
          proposal: approval.proposal,
          summary: `Created share approval ${approval.id}: ${proposal.summary}. No share service was changed.`
        }
      });

      reply.status(202).send({
        message,
        job,
        approval,
        operation: toPublicShareOperation(operation)
      });
    } catch (error) {
      reply.status(400).send({ error: safeShareMessage(error) });
    }
  });
}

function shareProposalSummary(settings: Awaited<ReturnType<typeof normalizeShareSettingsInput>>): string {
  const enabledProtocols = settings.shares.reduce(
    (count, share) =>
      count +
      Number(share.protocols.smb.enabled) +
      Number(share.protocols.webdav.enabled) +
      Number(share.protocols.ftp.enabled) +
      Number(share.protocols.nfs.enabled) +
      Number(share.protocols.dlna.enabled),
    0
  );
  return `Apply share services configuration for ${settings.shares.length} share${settings.shares.length === 1 ? "" : "s"} and ${enabledProtocols} enabled protocol${enabledProtocols === 1 ? "" : "s"}`;
}
