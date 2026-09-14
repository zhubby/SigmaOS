import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  webServer: {
    command: "node tests/preview-server.mjs",
    port: 4321,
    reuseExistingServer: true
  },
  use: {
    baseURL: "http://127.0.0.1:4321",
    headless: true
  }
});
