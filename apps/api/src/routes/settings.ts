import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  DEFAULT_PI_TOOL_POLICY_SETTINGS,
  defaultPiToolPolicySettings,
  getDockerSettings,
  getModelProviderSettings,
  getPiToolPolicySettings,
  getShareSettings,
  saveDockerSettings,
  saveModelProviderSettings,
  savePiToolPolicySettings
} from "@sigmaos/db";
import type { DockerSettingsRecord, ModelProviderName, PiToolPolicySettingsRecord } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import {
  defaultDockerSettings,
  defaultShareSettings,
  defaultModelProviderSettings,
  effectiveDockerConfig,
  isModelProviderName,
  normalizeOptionalText,
  toPublicDockerSettings,
  toPublicShareSettings,
  toPublicModelProviderSettings,
  toPublicPiToolPolicySettings
} from "../lib/settings.js";
import { collectSystemInfo } from "../lib/system-info.js";

export function registerSettingsRoutes(server: FastifyInstance, { config, db }: ApiRouteContext): void {
  server.get("/api/settings/system-info", async () => ({
    info: await collectSystemInfo(effectiveDockerConfig(config, getDockerSettings(db)))
  }));

  server.get("/api/settings/model-provider", async () => ({
    settings: toPublicModelProviderSettings(getModelProviderSettings(db) ?? defaultModelProviderSettings(config))
  }));

  server.patch<{
    Body: {
      providerName?: string;
      provider?: string;
      baseUrl?: string | null;
      model?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    };
  }>("/api/settings/model-provider", async (request, reply) => {
    const existing = getModelProviderSettings(db) ?? defaultModelProviderSettings(config);
    const providerName = request.body?.providerName ?? request.body?.provider ?? existing.providerName;
    if (!isModelProviderName(providerName)) {
      reply.status(400).send({ error: "Unsupported model provider" });
      return;
    }

    const normalizedProviderName = providerName.trim() as ModelProviderName;
    const baseUrl =
      request.body?.baseUrl === undefined ? existing.baseUrl : normalizeOptionalText(request.body.baseUrl);
    const model =
      request.body?.model === undefined ? existing.model : normalizeOptionalText(request.body.model) ?? "";
    const apiKey = request.body?.clearApiKey
      ? null
      : normalizeOptionalText(request.body?.apiKey) ?? existing.apiKey;

    const settings = saveModelProviderSettings(db, {
      providerName: normalizedProviderName,
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

  server.get("/api/settings/docker", async () => ({
    settings: toPublicDockerSettings(getDockerSettings(db) ?? defaultDockerSettings(config))
  }));

  server.get("/api/settings/shares", async () => ({
    settings: toPublicShareSettings(getShareSettings(db) ?? defaultShareSettings(config))
  }));

  server.patch<{
    Body: {
      enabled?: boolean;
      socketPath?: string;
      composeCommand?: string;
      operationTimeoutMs?: number | string;
      consoleShells?: string[] | string;
      composeRoots?: Array<{
        id?: string;
        name?: string;
        path?: string;
      }>;
    };
  }>("/api/settings/docker", async (request, reply) => {
    const existing = getDockerSettings(db) ?? defaultDockerSettings(config);

    try {
      const settings = saveDockerSettings(db, {
        enabled: request.body?.enabled ?? existing.enabled,
        socketPath: normalizeTextField(request.body?.socketPath, existing.socketPath, "/var/run/docker.sock"),
        composeCommand: normalizeTextField(request.body?.composeCommand, existing.composeCommand, "docker"),
        operationTimeoutMs: normalizePositiveInteger(
          request.body?.operationTimeoutMs,
          existing.operationTimeoutMs
        ),
        consoleShells: normalizeDockerShells(request.body?.consoleShells, existing.consoleShells),
        composeRoots: normalizeDockerRoots(request.body?.composeRoots, existing.composeRoots)
      });

      reply.send({
        settings: toPublicDockerSettings(settings)
      });
    } catch (error) {
      reply.status(400).send({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function normalizeTextField(value: string | undefined, fallback: string, defaultValue: string): string {
  const candidate = normalizeOptionalText(value) ?? fallback;
  return candidate || defaultValue;
}

function normalizePositiveInteger(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Docker operation timeout must be a positive integer");
  }
  return parsed;
}

function normalizeDockerShells(value: string[] | string | undefined, fallback: string[]): string[] {
  const rawShells = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/gu) : fallback;
  const shells = rawShells.map((shell) => shell.trim()).filter(Boolean);
  if (!shells.length) {
    return fallback;
  }
  return shells.map((shell) => {
    if (!path.isAbsolute(shell)) {
      throw new Error(`Docker console shell must be an absolute path: ${shell}`);
    }
    return shell;
  });
}

function normalizeDockerRoots(
  roots: Array<{ id?: string; name?: string; path?: string }> | undefined,
  fallback: DockerSettingsRecord["composeRoots"]
): DockerSettingsRecord["composeRoots"] {
  if (!roots) {
    return fallback;
  }

  const normalized = roots
    .map((root, index) => {
      const pathValue = normalizeOptionalText(root.path);
      if (!pathValue) {
        throw new Error(`Docker compose root ${index + 1} is missing a path`);
      }
      const resolvedPath = path.resolve(process.cwd(), pathValue);
      const id = normalizeOptionalText(root.id) ?? `compose-root-${index + 1}`;
      const name = normalizeOptionalText(root.name) ?? id;
      return {
        id,
        name,
        path: resolvedPath
      };
    })
    .filter((root) => Boolean(root.path));

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const root of normalized) {
    if (ids.has(root.id)) {
      throw new Error(`Docker compose root id must be unique: ${root.id}`);
    }
    if (paths.has(root.path)) {
      throw new Error(`Docker compose root path must be unique: ${root.path}`);
    }
    ids.add(root.id);
    paths.add(root.path);
  }

  return normalized;
}
