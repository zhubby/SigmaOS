import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createDockerConsoleAuthorization,
  createDockerOperationApproval,
  createUserMessageAndJob,
  consumeDockerConsoleAuthorization,
  getApproval,
  getDockerOperation,
  getSession,
  listDockerOperations,
  markDockerConsoleAuthorizationFailed,
  updateApprovalStatus,
  updateDockerOperationStatus,
  updateJobStatus
} from "@sigmaos/db";
import type {
  DockerConsoleAuthorizationRecord,
  DockerContainerSummary,
  DockerOperationAction,
  DockerOperationProposal,
  DockerOperationTargetType
} from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { dockerCompose, dockerEngine, collectDockerSummary, safeDockerMessage } from "../lib/docker-service.js";

type DockerProposalBody = {
  sessionId?: string;
  action?: DockerOperationAction;
  targetType?: DockerOperationTargetType;
  containerId?: string;
  composeProjectId?: string;
  service?: string;
  shell?: string;
};

export function registerDockerRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const { config, db, docker } = context;

  server.get("/api/docker/summary", async () => ({
    summary: await collectDockerSummary(config, docker)
  }));

  server.get<{
    Querystring: { sessionId?: string };
  }>("/api/docker/operations", async (request) => ({
    operations: listDockerOperations(db, {
      ...(request.query.sessionId ? { sessionId: request.query.sessionId } : {}),
      limit: 100
    })
  }));

  server.get<{
    Params: { id: string };
    Querystring: { tail?: string };
  }>("/api/docker/containers/:id/logs", async (request, reply) => {
    if (!config.docker.enabled) {
      reply.status(503).send({ error: "Docker management is disabled" });
      return;
    }
    const tail = Number.parseInt(request.query.tail ?? "200", 10);
    try {
      const logs = await dockerEngine(config.docker, docker).getContainerLogs(
        request.params.id,
        Number.isInteger(tail) ? tail : 200
      );
      reply.send({ logs });
    } catch (error) {
      reply.status(502).send({ error: safeDockerMessage(error) });
    }
  });

  server.post<{
    Body: DockerProposalBody;
  }>("/api/docker/proposals", async (request, reply) => {
    if (!config.docker.enabled) {
      reply.status(503).send({ error: "Docker management is disabled" });
      return;
    }

    const session = getSession(db, request.body?.sessionId ?? "");
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      const proposal = await buildDockerProposal(request.body ?? {}, context);
      const { message, job } = createUserMessageAndJob(db, {
        sessionId: session.id,
        content: proposal.summary,
        status: "waiting_approval"
      });
      const { approval, operation } = createDockerOperationApproval(db, {
        jobId: job.id,
        proposal
      });
      appendEvent(db, {
        sessionId: session.id,
        jobId: job.id,
        type: "approval.pending",
        payload: {
          approvalId: approval.id,
          proposal: approval.proposal,
          summary: `Created Docker approval ${approval.id}: ${proposal.summary}. No Docker action was run.`
        }
      });

      reply.status(202).send({
        message,
        job,
        approval,
        operation
      });
    } catch (error) {
      reply.status(400).send({ error: safeDockerMessage(error) });
    }
  });

  server.post<{
    Body: { operationId?: string };
  }>("/api/docker/console-sessions", async (request, reply) => {
    if (!config.docker.enabled) {
      reply.status(503).send({ error: "Docker management is disabled" });
      return;
    }

    const operation = getDockerOperation(db, request.body?.operationId ?? "");
    if (!operation || operation.action !== "console" || operation.status !== "approved" || !operation.approvalId) {
      reply.status(404).send({ error: "Approved console operation not found" });
      return;
    }
    const proposal = dockerProposalFromOperation(operation);
    if (!proposal?.containerId || !proposal.shell) {
      reply.status(400).send({ error: "Console operation is missing container or shell metadata" });
      return;
    }

    let authorization: DockerConsoleAuthorizationRecord;
    try {
      authorization = createDockerConsoleAuthorization(db, {
        operationId: operation.id,
        approvalId: operation.approvalId,
        containerId: proposal.containerId,
        shell: proposal.shell
      });
    } catch (error) {
      reply.status(404).send({ error: safeDockerMessage(error) });
      return;
    }
    updateDockerOperationStatus(db, operation.id, "approved", {
      consoleSessionId: authorization.id
    });

    reply.status(201).send({
      consoleSession: {
        id: authorization.id,
        operationId: operation.id,
        containerId: authorization.containerId,
        shell: authorization.shell,
        expiresAt: authorization.expiresAt,
        websocketUrl: `/api/docker/console/${authorization.id}`
      }
    });
  });

  server.get<{
    Params: { id: string };
  }>("/api/docker/console/:id", { websocket: true }, async (socket, request) => {
    if (!config.docker.enabled) {
      sendSocket(socket, { type: "error", error: "Docker management is disabled" });
      socket.close();
      return;
    }

    const authorization = consumeDockerConsoleAuthorization(db, request.params.id);
    if (!authorization) {
      sendSocket(socket, { type: "error", error: "Console session is not available" });
      socket.close();
      return;
    }

    const engine = dockerEngine(config.docker, docker);
    let execId: string | null = null;
    try {
      execId = await engine.createExec(authorization.containerId, authorization.shell);
      const stream = await engine.startExec(execId);
      markConsoleStarted(context, authorization, execId);
      sendSocket(socket, { type: "ready" });
      stream.socket.on("data", (chunk: Buffer) => {
        sendSocket(socket, { type: "output", data: chunk.toString("utf8") });
      });
      stream.socket.on("close", () => {
        sendSocket(socket, { type: "exit" });
        socket.close();
      });
      stream.socket.on("error", (error) => {
        sendSocket(socket, { type: "error", error: safeDockerMessage(error) });
        socket.close();
      });
      socket.on("message", (raw: unknown) => {
        const message = parseSocketMessage(socketDataToString(raw));
        if (!message) {
          return;
        }
        if (message.type === "input") {
          stream.socket.write(message.data);
        }
        if (message.type === "resize" && execId) {
          void engine.resizeExec(execId, message.cols, message.rows).catch((error) => {
            sendSocket(socket, { type: "error", error: safeDockerMessage(error) });
          });
        }
      });
      socket.on("close", () => {
        stream.socket.destroy();
      });
    } catch (error) {
      const message = safeDockerMessage(error);
      markConsoleStartupFailed(context, authorization, message);
      sendSocket(socket, { type: "error", error: message });
      socket.close();
    }
  });
}

async function buildDockerProposal(
  body: DockerProposalBody,
  { config, docker }: ApiRouteContext
): Promise<DockerOperationProposal> {
  const action = body.action;
  if (!action) {
    throw new Error("Docker action is required");
  }

  if (isContainerAction(action) || action === "console") {
    const summary = await collectDockerSummary({ ...config, docker: config.docker }, docker);
    const container = findContainer(summary.containers, body.containerId);
    if (!container) {
      throw new Error("Docker container not found");
    }
    const shell = action === "console" ? validatedShell(config.docker.consoleShells, body.shell) : undefined;
    return {
      action,
      targetType: action === "console" ? "console" : "container",
      containerId: container.id,
      containerName: container.name,
      ...(shell ? { shell } : {}),
      risk: action === "console" || action === "remove" ? "high" : "medium",
      summary:
        action === "console"
          ? `Open Docker console for ${container.name} with ${shell}`
          : `${actionLabel(action)} Docker container ${container.name}`
    };
  }

  if (isComposeAction(action)) {
    if (!body.composeProjectId) {
      throw new Error("Compose project id is required");
    }
    const compose = dockerCompose(config.docker, docker);
    const project = await compose.getProject(body.composeProjectId);
    if (!project) {
      throw new Error("Compose project is not configured");
    }
    const service = validatedComposeService(project.services, action, body.service);
    return {
      action,
      targetType: "compose_project",
      composeProjectId: project.id,
      composeProjectName: project.name,
      composeRootId: project.rootId,
      composeFilePath: project.filePath,
      ...(service ? { service } : {}),
      risk: action === "compose_down" ? "high" : "medium",
      summary: `${actionLabel(action)} Docker Compose project ${project.name}${service ? ` service ${service}` : ""}`
    };
  }

  throw new Error("Unsupported Docker action");
}

function dockerProposalFromOperation(operation: { metadata: Record<string, unknown> }): DockerOperationProposal | null {
  const proposal = operation.metadata.proposal;
  if (!proposal || typeof proposal !== "object" || !("action" in proposal)) {
    return null;
  }
  return proposal as DockerOperationProposal;
}

function findContainer(containers: DockerContainerSummary[], containerId: string | undefined): DockerContainerSummary | null {
  if (!containerId) {
    return null;
  }
  return (
    containers.find(
      (container) =>
        container.id === containerId ||
        container.shortId === containerId ||
        container.id.startsWith(containerId) ||
        container.name === containerId
    ) ?? null
  );
}

function validatedShell(shells: string[], requested: string | undefined): string {
  const shell = requested || shells[0];
  if (!shell || !shells.includes(shell)) {
    throw new Error("Docker console shell is not allowed");
  }
  return shell;
}

function validatedComposeService(
  services: string[],
  action: DockerOperationAction,
  requested: string | undefined
): string | undefined {
  const service = requested?.trim();
  if (!service) {
    return undefined;
  }
  if (action === "compose_down") {
    throw new Error("Compose down does not support a service target");
  }
  if (service.startsWith("-")) {
    throw new Error("Compose service name is not allowed");
  }
  if (!services.includes(service)) {
    throw new Error("Compose service is not part of the configured project");
  }
  return service;
}

function markConsoleStarted(
  { db }: ApiRouteContext,
  authorization: DockerConsoleAuthorizationRecord,
  execId: string
) {
  const applied = updateDockerOperationStatus(db, authorization.operationId, "applied", {
    consoleSessionId: authorization.id,
    execId,
    openedAt: new Date().toISOString()
  });
  const approval = getApproval(db, authorization.approvalId);
  if (!approval) {
    return;
  }
  updateApprovalStatus(db, approval.id, "applied", ["approved"]);
  updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval", "completed"]);
  appendEvent(db, {
    sessionId: approval.sessionId,
    jobId: approval.jobId,
    type: "job.completed",
    payload: {
      jobId: approval.jobId,
      approvalId: approval.id,
      dockerOperation: applied
    }
  });
}

function markConsoleStartupFailed(
  { db }: ApiRouteContext,
  authorization: DockerConsoleAuthorizationRecord,
  message: string
) {
  markDockerConsoleAuthorizationFailed(db, authorization.id);
  const failed = updateDockerOperationStatus(db, authorization.operationId, "failed", {
    error: message,
    failedAt: new Date().toISOString()
  });
  const approval = getApproval(db, authorization.approvalId);
  if (!approval) {
    return;
  }
  updateApprovalStatus(db, approval.id, "failed", ["approved", "applied"]);
  updateJobStatus(db, approval.jobId, "failed", message);
  appendEvent(db, {
    sessionId: approval.sessionId,
    jobId: approval.jobId,
    type: "job.failed",
    payload: {
      error: message,
      approvalId: approval.id,
      dockerOperation: failed
    }
  });
}

function isContainerAction(action: DockerOperationAction): boolean {
  return action === "start" || action === "stop" || action === "restart" || action === "remove";
}

function isComposeAction(action: DockerOperationAction): boolean {
  return action === "compose_up" || action === "compose_down" || action === "compose_pull" || action === "compose_restart";
}

function actionLabel(action: DockerOperationAction): string {
  switch (action) {
    case "compose_up":
      return "Deploy";
    case "compose_down":
      return "Stop";
    case "compose_pull":
      return "Pull images for";
    case "compose_restart":
      return "Restart";
    default:
      return action[0] ? `${action[0].toUpperCase()}${action.slice(1)}` : action;
  }
}

function sendSocket(socket: { send(data: string): void }, payload: Record<string, unknown>) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The client may already be closed.
  }
}

function socketDataToString(raw: unknown): string {
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.filter(Buffer.isBuffer)).toString("utf8");
  }
  return String(raw);
}

function parseSocketMessage(raw: string):
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return { type: "input", data: parsed.data };
    }
    if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
      return { type: "resize", cols: parsed.cols, rows: parsed.rows };
    }
  } catch {
    return null;
  }
  return null;
}
