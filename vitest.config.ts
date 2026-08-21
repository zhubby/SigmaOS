import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "packaging/**/*.test.ts"],
    pool: "threads"
  },
  resolve: {
    alias: {
      "@sigmaos/agent": new URL("packages/agent/src/index.ts", `file://${root}`).pathname,
      "@sigmaos/db": new URL("packages/db/src/index.ts", `file://${root}`).pathname,
      "@sigmaos/nas-tools": new URL("packages/nas-tools/src/index.ts", `file://${root}`).pathname,
      "@sigmaos/shared": new URL("packages/shared/src/index.ts", `file://${root}`).pathname
    }
  }
});
