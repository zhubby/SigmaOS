import { describe, expect, it } from "vitest";
import { dockerSettingsToForm, settingsSectionState, type SettingsSection } from "./settings.js";

describe("settings helpers", () => {
  it("treats saved Docker settings as configured even when disabled", () => {
    const section: SettingsSection = {
      id: "docker",
      group: "administration"
    };

    expect(settingsSectionState(section, null, null)).toBe("missing");
    expect(
      settingsSectionState(section, null, {
        enabled: false,
        socketPath: "/var/run/docker.sock",
        composeCommand: "docker",
        operationTimeoutMs: 120_000,
        consoleShells: ["/bin/sh", "/bin/bash"],
        composeRoots: [],
        updatedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe("ready");
  });

  it("hydrates Docker form defaults from the runtime config", () => {
    expect(dockerSettingsToForm(null)).toMatchObject({
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: String(120_000),
      consoleShells: "/bin/sh, /bin/bash",
      composeRoots: []
    });
  });
});
