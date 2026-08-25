import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerSocketClient } from "./docker-client.js";

let tempDir: string;
let socketPath: string;
let server: http.Server;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-docker-client-"));
  socketPath = path.join(tempDir, "docker.sock");
  server = http.createServer((request, response) => {
    const url = request.url ?? "";
    if (url === "/version") {
      sendJson(response, { Version: "27.1.0", ApiVersion: "1.55", Os: "linux", Arch: "amd64" });
      return;
    }
    if (url === "/v1.55/info") {
      sendJson(response, {
        ServerVersion: "27.1.0",
        OperatingSystem: "Debian",
        Architecture: "x86_64",
        DockerRootDir: "/var/lib/docker"
      });
      return;
    }
    if (url === "/v1.55/containers/json?all=1") {
      sendJson(response, [
        {
          Id: "abcdef1234567890",
          Names: ["/media"],
          Image: "jellyfin:latest",
          State: "running",
          Status: "Up 2 minutes",
          Created: 1,
          Ports: [{ PrivatePort: 8096, PublicPort: 8096, Type: "tcp" }],
          Labels: {
            "com.docker.compose.project": "media",
            "com.docker.compose.service": "jellyfin"
          }
        }
      ]);
      return;
    }
    if (url === "/v1.55/containers/abcdef1234567890/stats?stream=false") {
      sendJson(response, {
        cpu_stats: {
          cpu_usage: { total_usage: 300 },
          system_cpu_usage: 2000,
          online_cpus: 2
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000
        },
        memory_stats: {
          usage: 1024,
          limit: 4096,
          stats: { cache: 128 }
        }
      });
      return;
    }
    if (url === "/v1.55/images/json") {
      sendJson(response, [{ Id: "image-1" }, { Id: "image-2" }]);
      return;
    }
    if (url === "/v1.55/networks") {
      sendJson(response, [{ Id: "network-1" }]);
      return;
    }
    if (url === "/v1.55/volumes") {
      sendJson(response, { Volumes: [{ Name: "volume-1" }, { Name: "volume-2" }, { Name: "volume-3" }] });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: `Unhandled ${url}` }));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
});

describe("DockerSocketClient", () => {
  it("maps Docker Engine socket responses into runtime summaries", async () => {
    const client = new DockerSocketClient({ socketPath, timeoutMs: 1000 });

    await expect(client.getInfo()).resolves.toMatchObject({
      version: "27.1.0",
      apiVersion: "1.55",
      operatingSystem: "Debian",
      dockerRootDir: "/var/lib/docker"
    });
    await expect(client.getCounts()).resolves.toEqual({
      images: 2,
      networks: 1,
      volumes: 3
    });
    await expect(client.listContainers()).resolves.toMatchObject([
      {
        id: "abcdef1234567890",
        shortId: "abcdef123456",
        name: "media",
        image: "jellyfin:latest",
        state: "running",
        ports: ["8096->8096/tcp"],
        composeProject: "media",
        composeService: "jellyfin",
        cpuPercent: 40,
        memoryUsageBytes: 896,
        memoryLimitBytes: 4096,
        memoryPercent: 21.875
      }
    ]);
  });
});

function sendJson(response: http.ServerResponse, body: unknown): void {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}
