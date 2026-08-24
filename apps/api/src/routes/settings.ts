import type { FastifyInstance } from "fastify";
import {
  DEFAULT_PI_TOOL_POLICY_SETTINGS,
  defaultPiToolPolicySettings,
  getModelProviderSettings,
  getPiToolPolicySettings,
  saveModelProviderSettings,
  savePiToolPolicySettings
} from "@sigmaos/db";
import type { PiToolPolicySettingsRecord } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import {
  defaultModelProviderSettings,
  isProviderName,
  normalizeOptionalText,
  toPublicModelProviderSettings,
  toPublicPiToolPolicySettings
} from "../lib/settings.js";

export function registerSettingsRoutes(server: FastifyInstance, { config, db }: ApiRouteContext): void {
  server.get("/api/settings/model-provider", async () => ({
    settings: toPublicModelProviderSettings(getModelProviderSettings(db) ?? defaultModelProviderSettings(config))
  }));

  server.patch<{
    Body: {
      providerName?: string;
      provider?: string;
      displayName?: string;
      baseUrl?: string | null;
      model?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    };
  }>("/api/settings/model-provider", async (request, reply) => {
    const existing = getModelProviderSettings(db) ?? defaultModelProviderSettings(config);
    const providerName = request.body?.providerName ?? request.body?.provider ?? existing.providerName;
    if (!isProviderName(providerName)) {
      reply.status(400).send({ error: "Unsupported model provider" });
      return;
    }

    const normalizedProviderName = providerName.trim();
    const displayName = normalizeOptionalText(request.body?.displayName) ?? existing.displayName;
    const baseUrl =
      request.body?.baseUrl === undefined ? existing.baseUrl : normalizeOptionalText(request.body.baseUrl);
    const model = normalizeOptionalText(request.body?.model) ?? existing.model;
    const apiKey = request.body?.clearApiKey
      ? null
      : normalizeOptionalText(request.body?.apiKey) ?? existing.apiKey;

    const settings = saveModelProviderSettings(db, {
      providerName: normalizedProviderName,
      displayName,
      baseUrl,
      model,
      apiKey
    });

    reply.send({
      settings: toPublicModelProviderSettings(settings)
    });
  });

  server.get("/api/settings/pi-tool-policy", async () => ({
    settings: toPublicPiToolPolicySettings(getPiToolPolicySettings(db) ?? defaultPiToolPolicySettings())
  }));

  server.patch<{
    Body: Partial<Record<keyof typeof DEFAULT_PI_TOOL_POLICY_SETTINGS, string>>;
  }>("/api/settings/pi-tool-policy", async (request, reply) => {
    const existing = getPiToolPolicySettings(db) ?? defaultPiToolPolicySettings();
    const next = {
      ...DEFAULT_PI_TOOL_POLICY_SETTINGS,
      ...existing,
      ...request.body
    };

    try {
      const settings = savePiToolPolicySettings(db, {
        read: next.read,
        grep: next.grep,
        find: next.find,
        ls: next.ls,
        bash: next.bash,
        edit: next.edit,
        write: next.write
      } as Omit<PiToolPolicySettingsRecord, "updatedAt">);
      reply.send({
        settings: toPublicPiToolPolicySettings(settings)
      });
    } catch (error) {
      reply.status(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
