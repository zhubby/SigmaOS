import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  DockerComposeProjectSummary,
  DockerConfig,
  DockerContainerSummary,
  DockerOperationProposal
} from "@sigmaos/shared";
import { isPathInside } from "@sigmaos/nas-tools";

export interface DockerComposeRuntime {
  listProjects(containers: DockerContainerSummary[]): Promise<DockerComposeProjectSummary[]>;
  getProject(
    projectId: string,
    containers?: DockerContainerSummary[]
  ): Promise<DockerComposeProjectSummary | null>;
  runProjectAction(proposal: DockerOperationProposal): Promise<{ output: string }>;
}

const COMPOSE_FILE_NAMES = new Set([
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml"
]);
const MAX_SCAN_DEPTH = 4;

export class DockerComposeService implements DockerComposeRuntime {
  constructor(private readonly config: DockerConfig) {}

  async listProjects(containers: DockerContainerSummary[]): Promise<DockerComposeProjectSummary[]> {
    const projects: DockerComposeProjectSummary[] = [];
    for (const root of this.config.composeRoots) {
      let rootRealPath: string;
      try {
        rootRealPath = await realpath(root.path);
      } catch {
        continue;
      }
      const files = await scanComposeFiles(rootRealPath, 0);
      for (const discoveredFilePath of files) {
        const validatedProject = await validateComposeFile(rootRealPath, discoveredFilePath).catch(() => null);
        if (!validatedProject) {
          continue;
        }
        const { filePath, workingDir } = validatedProject;
        const name = composeProjectName(workingDir, root.id);
        const projectContainers = containers.filter((container) => container.composeProject === name);
        const services = await this.listServices(filePath, workingDir).catch(() =>
          Array.from(
            new Set(
              projectContainers
                .map((container) => container.composeService)
                .filter((service): service is string => Boolean(service))
            )
          )
        );
        projects.push({
          id: `${root.id}:${path.relative(rootRealPath, filePath)}`,
          name,
          rootId: root.id,
          rootName: root.name,
          filePath,
          workingDir,
          services,
          containerCount: projectContainers.length,
          runningCount: projectContainers.filter((container) => container.state === "running").length,
          status: projectStatus(projectContainers)
        });
      }
    }
    return projects.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getProject(
    projectId: string,
    containers: DockerContainerSummary[] = []
  ): Promise<DockerComposeProjectSummary | null> {
    const projects = await this.listProjects(containers);
    return projects.find((project) => project.id === projectId) ?? null;
  }

  async runProjectAction(proposal: DockerOperationProposal): Promise<{ output: string }> {
    if (!proposal.composeProjectId) {
      throw new Error("Compose project id is required");
    }
    const project = await this.getProject(proposal.composeProjectId);
    if (!project) {
      throw new Error("Compose project is not configured");
    }
    const runnableProject = await validateRunnableProject(project, this.config);

    const actionArgs = composeActionArgs(proposal);
    const output = await runCommand(
      this.config.composeCommand,
      ["compose", "-f", runnableProject.filePath, ...actionArgs],
      runnableProject.workingDir,
      this.config.operationTimeoutMs
    );
    return { output };
  }

  private async listServices(filePath: string, workingDir: string): Promise<string[]> {
    const output = await runCommand(
      this.config.composeCommand,
      ["compose", "-f", filePath, "config", "--services"],
      workingDir,
      this.config.operationTimeoutMs
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

async function scanComposeFiles(directory: string, depth: number): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isFile() && COMPOSE_FILE_NAMES.has(entry.name)) {
      files.push(entryPath);
      continue;
    }
    if (entry.isDirectory()) {
      const stats = await lstat(entryPath).catch(() => null);
      if (stats?.isSymbolicLink()) {
        continue;
      }
      files.push(...(await scanComposeFiles(entryPath, depth + 1)));
    }
  }
  return files;
}

function composeProjectName(workingDir: string, fallback: string): string {
  return path.basename(workingDir).replace(/[^a-zA-Z0-9_-]/gu, "").toLowerCase() || fallback;
}

function projectStatus(containers: DockerContainerSummary[]): DockerComposeProjectSummary["status"] {
  if (!containers.length) {
    return "configured";
  }
  const running = containers.filter((container) => container.state === "running").length;
  if (running === containers.length) {
    return "running";
  }
  if (running > 0) {
    return "partial";
  }
  return "stopped";
}

function composeActionArgs(proposal: DockerOperationProposal): string[] {
  const service = proposal.service ? [proposal.service] : [];
  switch (proposal.action) {
    case "compose_up":
      return ["up", "-d", ...service];
    case "compose_down":
      return ["down"];
    case "compose_pull":
      return ["pull", ...service];
    case "compose_restart":
      return ["restart", ...service];
    default:
      throw new Error("Unsupported Compose action");
  }
}

async function validateRunnableProject(
  project: DockerComposeProjectSummary,
  config: DockerConfig
): Promise<{ filePath: string; workingDir: string }> {
  const root = config.composeRoots.find((candidate) => candidate.id === project.rootId);
  if (!root) {
    throw new Error("Compose project root is not configured");
  }

  const rootRealPath = await realpath(root.path);
  return validateComposeFile(rootRealPath, project.filePath, project.workingDir);
}

async function validateComposeFile(
  rootRealPath: string,
  filePath: string,
  expectedWorkingDir?: string
): Promise<{ filePath: string; workingDir: string }> {
  const [workingDirRealPath, fileStats] = await Promise.all([
    realpath(path.dirname(filePath)),
    lstat(filePath)
  ]);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error("Compose file is not a regular file");
  }

  const fileRealPath = await realpath(filePath);
  if (!isPathInside(rootRealPath, workingDirRealPath) || !isPathInside(rootRealPath, fileRealPath)) {
    throw new Error("Compose project escapes the configured root");
  }
  if (expectedWorkingDir && (await realpath(expectedWorkingDir)) !== workingDirRealPath) {
    throw new Error("Compose working directory changed");
  }
  if (path.dirname(fileRealPath) !== workingDirRealPath) {
    throw new Error("Compose file and working directory do not match");
  }

  return {
    filePath: fileRealPath,
    workingDir: workingDirRealPath
  };
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const clearForceKillTimer = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };
    function settle(callback: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
      settle(() => reject(new Error(`docker compose timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output = truncateOutput(output + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = truncateOutput(output + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      clearForceKillTimer();
      settle(() => reject(error));
    });
    child.on("close", (exitCode) => {
      clearForceKillTimer();
      if (settled) {
        return;
      }
      if (exitCode === 0) {
        settle(() => resolve(output));
        return;
      }
      settle(() => reject(new Error(`docker compose exited with ${exitCode ?? "signal"}`)));
    });
  });
}

function truncateOutput(output: string): string {
  return output.length > 16_000 ? output.slice(output.length - 16_000) : output;
}
