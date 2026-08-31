import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ModelProviderSettingsRecord } from "@sigmaos/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerConfiguredProvider } from "./pi-agent.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-pi-agent-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("Pi agent provider configuration", () => {
  it("registers custom Anthropic-compatible models configured with a base URL", async () => {
    const modelRuntime = await createModelRuntime();
    const settings = modelProviderSettings({
      providerName: "anthropic",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      model: "qwen3.8-max"
    });

    expect(modelRuntime.getModel("anthropic", "qwen3.8-max")).toBeUndefined();

    registerConfiguredProvider(modelRuntime, settings);

    expect(modelRuntime.getModel("anthropic", "qwen3.8-max")).toMatchObject({
      provider: "anthropic",
      id: "qwen3.8-max",
      name: "qwen3.8-max",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      api: "anthropic-messages",
      input: ["text"],
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 16384
    });
  });

  it("registers custom OpenAI-compatible models configured with a base URL", async () => {
    const modelRuntime = await createModelRuntime();
    const settings = modelProviderSettings({
      providerName: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model"
    });

    registerConfiguredProvider(modelRuntime, settings);

    expect(modelRuntime.getModel("openai", "local-model")).toMatchObject({
      provider: "openai",
      id: "local-model",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions"
    });
  });
});

async function createModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: path.join(tempDir, "auth.json"),
    modelsPath: null
  });
}

function modelProviderSettings(
  overrides: Partial<ModelProviderSettingsRecord>
): ModelProviderSettingsRecord {
  return {
    providerName: "openai",
    baseUrl: null,
    model: "",
    apiKey: "secret-token",
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}
