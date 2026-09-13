import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest } from "fastify";

export async function registerWebApp(server: FastifyInstance, webDist: string): Promise<void> {
  await server.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    wildcard: true,
    cacheControl: false,
    etag: false,
    lastModified: false,
    setHeaders(reply, filePath) {
      const relativePath = path.relative(webDist, filePath);
      const cacheControl = relativePath === "index.html"
        ? "no-store"
        : relativePath.startsWith(`assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache";
      reply.header("Cache-Control", cacheControl);
    }
  });

  server.setNotFoundHandler((request, reply) => {
    if (isWebNavigation(request)) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Route ${request.method}:${request.url} not found`
    });
  });
}

function isWebNavigation(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const pathname = request.url.split("?", 1)[0] ?? "/";
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
    return false;
  }

  return request.headers.accept?.includes("text/html") ?? false;
}
