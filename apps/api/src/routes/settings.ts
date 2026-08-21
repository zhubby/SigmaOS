import type { FastifyInstance } from "fastify";
import { getModelProviderSettings, saveModelProviderSettings } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";
import {
  defaultModelProviderSettings,
  isModelProviderKind,
  normalizeOptionalText,
  toPublicModelProviderSettings
} from "../lib/settings.js";

export function registerSettingsRoutes(server: FastifyInstance, { config, db }: ApiRouteContext): void {
  server.get("/api/settings/model-provider", async () => ({
    settings: toPublicModelProviderSettings(getModelProviderSettings(db) ?? defaultModelProviderSettings(config))
  }));

  server.patch<{
    Body: {
      provider?: string;
      displayName?: string;
      baseUrl?: string | null;
      model?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    };
  }>("/api/settings/model-provider", async (request, reply) => {
    const existing = getModelProviderSettings(db) ?? defaultModelProviderSettings(config);
    const provider = request.body?.provider ?? existing.provider;
    if (!isModelProviderKind(provider)) {
      reply.status(400).send({ error: "Unsupported model provider" });
      return;
    }

    const displayName = normalizeOptionalText(request.body?.displayName) ?? existing.displayName;
    const baseUrl =
      request.body?.baseUrl === undefined ? existing.baseUrl : normalizeOptionalText(request.body.baseUrl);
    const model = normalizeOptionalText(request.body?.model) ?? existing.model;
    const apiKey = request.body?.clearApiKey
      ? null
      : normalizeOptionalText(request.body?.apiKey) ?? existing.apiKey;

    const settings = saveModelProviderSettings(db, {
      provider,
      displayName,
      baseUrl,
      model,
      apiKey
    });

    reply.send({
      settings: toPublicModelProviderSettings(settings)
    });
  });
}
