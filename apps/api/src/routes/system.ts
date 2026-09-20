import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  SystemWifiConnectInput,
  SystemWifiHotspotActionInput,
  SystemWifiHotspotUpdateInput,
  SystemWifiProfileUpdateInput,
  SystemWifiRadioInput,
  SystemWifiStatus
} from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { unknownBuildInfo } from "../lib/build-info.js";
import {
  NetworkManagerRequestError,
  safeNetworkManagerMessage,
  SystemNetworkManagerRuntime,
  type NetworkManagerRuntime
} from "../lib/network-manager.js";
import { collectSystemNetwork, collectSystemNetworkTraffic, collectSystemStorage } from "../lib/system-management.js";

const MAX_WIFI_BODY_BYTES = 64 * 1024;
const WIFI_SAMPLE_MS = 1000;
const WIFI_HEARTBEAT_MS = 15_000;

export function registerSystemRoutes(server: FastifyInstance, { buildInfo, config, system }: ApiRouteContext): void {
  const networkManager = system?.networkManager ?? new SystemNetworkManagerRuntime({
    ...(system?.commandRunner ? { commandRunner: system.commandRunner } : {}),
    helperSocketPath: config.shares.helperSocketPath
  });
  const systemDependencies = { ...system, networkManager };

  server.get("/api/system/build-info", async () => ({
    build: buildInfo ?? unknownBuildInfo()
  }));

  server.get("/api/system/network", async () => ({
    network: await collectSystemNetwork(systemDependencies)
  }));

  server.get("/api/system/network/traffic", async () => ({
    traffic: await collectSystemNetworkTraffic(system)
  }));

  server.get("/api/system/storage", async () => ({
    storage: await collectSystemStorage(system)
  }));

  server.post<{ Body: { device?: string } }>(
    "/api/system/network/wifi/scan",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        if (!request.body || typeof request.body.device !== "string") {
          throw new NetworkManagerRequestError("Wireless device is required", 400);
        }
        reply.send({ scan: await networkManager.scan({ device: request.body.device }) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.post<{ Body: SystemWifiConnectInput }>(
    "/api/system/network/wifi/connect",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        await requireManagementPathConfirmation(networkManager, request.body?.device, request.body?.confirmed);
        reply.send({ result: await networkManager.connect(request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.post<{ Body: { device: string; confirmed: boolean } }>(
    "/api/system/network/wifi/disconnect",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        requireConfirmation(request.body?.confirmed);
        reply.send({ result: await networkManager.disconnect(request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.put<{ Body: SystemWifiRadioInput }>(
    "/api/system/network/wifi/radio",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        if (request.body?.enabled === false) requireConfirmation(request.body.confirmed);
        reply.send({ result: await networkManager.setRadio(request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.patch<{ Params: { id: string }; Body: SystemWifiProfileUpdateInput }>(
    "/api/system/network/wifi/profiles/:id",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        reply.send({ result: await networkManager.updateProfile(request.params.id, request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.delete<{ Params: { id: string }; Body: { confirmed?: boolean } }>(
    "/api/system/network/wifi/profiles/:id",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        requireConfirmation(request.body?.confirmed);
        reply.send({ result: await networkManager.deleteProfile(request.params.id, true) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.put<{ Body: SystemWifiHotspotUpdateInput }>(
    "/api/system/network/wifi/hotspot",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        reply.send({ result: await networkManager.updateHotspot(request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  for (const [path, action] of [
    ["/api/system/network/wifi/hotspot/start", "startHotspot"],
    ["/api/system/network/wifi/hotspot/stop", "stopHotspot"]
  ] as const) {
    server.post<{ Body: SystemWifiHotspotActionInput }>(path, { bodyLimit: MAX_WIFI_BODY_BYTES }, async (request, reply) => {
      try {
        requireConfirmation(request.body?.confirmed);
        reply.send({ result: await networkManager[action](request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    });
  }

  server.delete<{ Body: SystemWifiHotspotActionInput }>(
    "/api/system/network/wifi/hotspot",
    { bodyLimit: MAX_WIFI_BODY_BYTES },
    async (request, reply) => {
      try {
        requireConfirmation(request.body?.confirmed);
        reply.send({ result: await networkManager.deleteHotspot(request.body) });
      } catch (error) {
        sendNetworkManagerError(reply, error);
      }
    }
  );

  server.get("/api/system/network/wifi/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    await streamWifiEvents(request.raw, reply.raw, networkManager);
  });
}

interface WifiEventCloseSignal {
  on(event: "close", listener: () => void): unknown;
}

interface WifiEventOutput {
  write(chunk: string): unknown;
}

export async function streamWifiEvents(
  closeSignal: WifiEventCloseSignal,
  output: WifiEventOutput,
  networkManager: Pick<NetworkManagerRuntime, "getStatus">,
  options: { sampleMs?: number; heartbeatMs?: number } = {}
): Promise<void> {
  const sampleMs = options.sampleMs ?? WIFI_SAMPLE_MS;
  const heartbeatMs = options.heartbeatMs ?? WIFI_HEARTBEAT_MS;
  let closed = false;
  let sampling = false;
  let lastSignature: string | null = null;
  let sampleTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  closeSignal.on("close", () => {
    closed = true;
    if (sampleTimer) clearInterval(sampleTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
  output.write("retry: 2000\n\n");

  const sample = async () => {
    if (closed || sampling) return;
    sampling = true;
    try {
      const status = await networkManager.getStatus();
      const signature = wifiStatusSignature(status);
      if (!closed && signature !== lastSignature) {
        lastSignature = signature;
        output.write("event: system.wifi.status\n");
        output.write(`data: ${JSON.stringify(status)}\n\n`);
      }
    } catch {
      const status: SystemWifiStatus = {
        collectedAt: new Date().toISOString(),
        backend: "unknown",
        radioEnabled: null,
        helperReady: false,
        devices: [],
        hotspots: []
      };
      const signature = wifiStatusSignature(status);
      if (!closed && signature !== lastSignature) {
        lastSignature = signature;
        output.write("event: system.wifi.status\n");
        output.write(`data: ${JSON.stringify(status)}\n\n`);
      }
    } finally {
      sampling = false;
    }
  };

  await sample();
  if (closed) return;
  sampleTimer = setInterval(() => void sample(), sampleMs);
  heartbeatTimer = setInterval(() => {
    if (!closed) output.write(": heartbeat\n\n");
  }, heartbeatMs);
}

function wifiStatusSignature(status: SystemWifiStatus): string {
  return JSON.stringify({
    backend: status.backend,
    radioEnabled: status.radioEnabled,
    helperReady: status.helperReady,
    devices: status.devices,
    hotspots: status.hotspots
  });
}

async function requireManagementPathConfirmation(
  networkManager: Pick<NetworkManagerRuntime, "getStatus">,
  device: string | undefined,
  confirmed: boolean | undefined
): Promise<void> {
  if (!device) throw new NetworkManagerRequestError("Wireless device is required", 400);
  const status = await networkManager.getStatus();
  if (status.devices.some((candidate) => candidate.name === device && candidate.managementPath) && !confirmed) {
    throw new NetworkManagerRequestError("Confirmation is required because this interface carries the management path", 400);
  }
}

function requireConfirmation(confirmed: boolean | undefined): void {
  if (!confirmed) throw new NetworkManagerRequestError("Confirmation is required", 400);
}

function sendNetworkManagerError(reply: FastifyReply, error: unknown): void {
  reply.status(error instanceof NetworkManagerRequestError ? error.statusCode : 503).send({
    error: safeNetworkManagerMessage(error),
    ...(error instanceof NetworkManagerRequestError ? { rollback: error.rollback } : {})
  });
}
