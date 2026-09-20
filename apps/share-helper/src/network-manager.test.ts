import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HelperCommandRunner } from "./helper.js";
import {
  executeNetworkManagerHelperRequest,
  inspectNetworkManagerProfiles,
  NetworkManagerHelperError,
  validateNetworkManagerHelperRequest
} from "./network-manager.js";

describe("NetworkManager helper", () => {
  let tempDir: string;
  let connectionsDir: string;
  let stateDir: string;
  let runner: FakeNetworkManagerRunner;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-network-manager-"));
    connectionsDir = path.join(tempDir, "etc/NetworkManager/system-connections");
    stateDir = path.join(tempDir, "var/lib/sigmaos/network-manager");
    runner = new FakeNetworkManagerRunner();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("validates typed actions and rejects unsafe values", () => {
    expect(validateNetworkManagerHelperRequest({ action: "scan", input: { device: "wlan0" } })).toEqual({
      action: "scan",
      input: { device: "wlan0" }
    });
    expect(() => validateNetworkManagerHelperRequest({ action: "scan", input: { device: "wlan0;reboot" } })).toThrow(
      "Invalid Wi-Fi scan request"
    );
    expect(() =>
      validateNetworkManagerHelperRequest({
        action: "connect",
        input: { device: "wlan0", ssid: "home", security: "wpa2", password: "short", confirmed: false }
      })
    ).toThrow("8-63");
    expect(() => validateNetworkManagerHelperRequest({ action: "delete_profile", profileId: crypto.randomUUID(), confirmed: false })).toThrow(
      "Confirmation"
    );
  });

  it("creates root-only managed profiles without putting credentials in command arguments", async () => {
    const password = "correct horse battery staple";
    await executeNetworkManagerHelperRequest(
      {
        action: "connect",
        input: {
          device: "wlan0",
          ssid: "Office:Lab",
          bssid: "AA:BB:CC:DD:EE:FF",
          security: "wpa2",
          password,
          autoconnect: true,
          confirmed: false
        }
      },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    const entries = await readdir(connectionsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^sigmaos-.*\.nmconnection$/u);
    const content = await readFile(path.join(connectionsDir, entries[0]!), "utf8");
    expect(content).toContain("ssid=Office\\:Lab");
    expect(content).toContain(`psk=${password}`);
    expect(runner.calls.join("\n")).not.toContain(password);
    expect(runner.calls.at(-1)).toContain("ap AA:BB:CC:DD:EE:FF");
  });

  it("returns BSSID-level scan results and classifies supported security", async () => {
    runner.scanOutput = [
      "*:Office\\:Lab:AA\\:BB\\:CC\\:DD\\:EE\\:FF:Infra:36:5180 MHz:82:WPA2",
      ":Legacy:11\\:22\\:33\\:44\\:55\\:66:Infra:6:2437 MHz:45:WEP",
      ":Guest:77\\:88\\:99\\:AA\\:BB\\:CC:Infra:1:2412 MHz:66:--"
    ].join("\n");

    const result = await executeNetworkManagerHelperRequest(
      { action: "scan", input: { device: "wlan0" } },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    expect(result).toMatchObject({
      device: "wlan0",
      accessPoints: [
        { ssid: "Office:Lab", bssid: "AA:BB:CC:DD:EE:FF", security: "wpa2", band: "5", frequencyMHz: 5180, active: true },
        { ssid: "Legacy", security: "unsupported" },
        { ssid: "Guest", security: "open" }
      ]
    });
  });

  it("rejects non-wireless devices and non-client profiles", async () => {
    await expect(
      executeNetworkManagerHelperRequest(
        { action: "scan", input: { device: "eth0" } },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "validation" });

    runner.profileType = "ethernet";
    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "connect",
          input: { device: "wlan0", profileId: PREVIOUS_PROFILE_ID, confirmed: false }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "validation" });

    runner.profileType = "wifi";
    runner.profileMode = "ap";
    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "connect",
          input: { device: "wlan0", profileId: PREVIOUS_PROFILE_ID, confirmed: false }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "validation" });
    expect(runner.calls.some((call) => call.includes(`connection up uuid ${PREVIOUS_PROFILE_ID}`))).toBe(false);
  });

  it("rejects symlinked profiles and stale revisions", async () => {
    await mkdir(connectionsDir, { recursive: true });
    const target = path.join(tempDir, "target.nmconnection");
    await writeFile(target, managedClientKeyfile(TEST_PROFILE_ID, "home"), "utf8");
    await symlink(target, path.join(connectionsDir, `sigmaos-${TEST_PROFILE_ID}.nmconnection`));
    await expect(inspectNetworkManagerProfiles({ connectionsDir, stateDir })).rejects.toBeInstanceOf(NetworkManagerHelperError);

    await rm(path.join(connectionsDir, `sigmaos-${TEST_PROFILE_ID}.nmconnection`));
    await writeFile(path.join(connectionsDir, `sigmaos-${TEST_PROFILE_ID}.nmconnection`), managedClientKeyfile(TEST_PROFILE_ID, "home"), "utf8");
    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "update_profile",
          profileId: TEST_PROFILE_ID,
          input: { ssid: "new-home", expectedRevision: "0".repeat(64), confirmed: false }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("removes stored credentials when a managed profile changes to open security", async () => {
    await mkdir(connectionsDir, { recursive: true });
    const filePath = path.join(connectionsDir, `sigmaos-${TEST_PROFILE_ID}.nmconnection`);
    await writeFile(filePath, managedClientKeyfile(TEST_PROFILE_ID, "home"), "utf8");
    const inspection = await inspectNetworkManagerProfiles({ connectionsDir, stateDir });

    await executeNetworkManagerHelperRequest(
      {
        action: "update_profile",
        profileId: TEST_PROFILE_ID,
        input: {
          security: "open",
          expectedRevision: inspection.profiles[0]!.revision,
          confirmed: false
        }
      },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("[wifi-security]");
    expect(content).not.toContain("psk=");
  });

  it("requires credentials for new hotspots and open profiles changed to WPA2", async () => {
    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "update_hotspot",
          input: {
            device: "wlan0",
            ssid: "SigmaOS",
            band: "2.4",
            channel: 6,
            autostart: false,
            confirmed: false
          }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "validation" });

    await mkdir(connectionsDir, { recursive: true });
    const filePath = path.join(connectionsDir, `sigmaos-${TEST_PROFILE_ID}.nmconnection`);
    await writeFile(filePath, managedOpenClientKeyfile(TEST_PROFILE_ID, "guest"), "utf8");
    const inspection = await inspectNetworkManagerProfiles({ connectionsDir, stateDir });
    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "update_profile",
          profileId: TEST_PROFILE_ID,
          input: {
            security: "wpa2",
            expectedRevision: inspection.profiles[0]!.revision,
            confirmed: false
          }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("restores the previous client when hotspot activation fails", async () => {
    await executeNetworkManagerHelperRequest(
      {
        action: "update_hotspot",
        input: {
          device: "wlan0",
          ssid: "SigmaOS",
          password: "hotspot-password",
          band: "5",
          channel: 36,
          autostart: false,
          confirmed: false
        }
      },
      { connectionsDir, stateDir, commandRunner: runner }
    );
    const inspection = await inspectNetworkManagerProfiles({ connectionsDir, stateDir });
    const hotspotId = inspection.profiles[0]!.id;
    runner.activeUuid = PREVIOUS_PROFILE_ID;
    runner.failProfileId = hotspotId;

    await expect(
      executeNetworkManagerHelperRequest(
        { action: "start_hotspot", input: { device: "wlan0", confirmed: true } },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "operation_failed", rollback: "succeeded" });
    expect(runner.calls).toContain(`nmcli connection up uuid ${PREVIOUS_PROFILE_ID} ifname wlan0`);
    await expect(readFile(path.join(stateDir, "state.json"), "utf8")).resolves.toBe("{}\n");
  });

  it("keeps the original recovery profile when hotspot start is repeated", async () => {
    await createHotspot(connectionsDir, stateDir, runner);
    const hotspotId = (await inspectNetworkManagerProfiles({ connectionsDir, stateDir })).profiles[0]!.id;
    runner.activeUuid = PREVIOUS_PROFILE_ID;

    await executeNetworkManagerHelperRequest(
      { action: "start_hotspot", input: { device: "wlan0", confirmed: true } },
      { connectionsDir, stateDir, commandRunner: runner }
    );
    const firstState = await readFile(path.join(stateDir, "state.json"), "utf8");
    expect(runner.activeUuid).toBe(hotspotId);

    await executeNetworkManagerHelperRequest(
      { action: "start_hotspot", input: { device: "wlan0", confirmed: true } },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    expect(await readFile(path.join(stateDir, "state.json"), "utf8")).toBe(firstState);
    expect(JSON.parse(firstState)).toMatchObject({
      wlan0: { restoreProfileId: PREVIOUS_PROFILE_ID, hotspotProfileId: hotspotId }
    });
  });

  it("reports hotspot stop failures and preserves recovery state", async () => {
    await createHotspot(connectionsDir, stateDir, runner);
    runner.activeUuid = PREVIOUS_PROFILE_ID;
    await executeNetworkManagerHelperRequest(
      { action: "start_hotspot", input: { device: "wlan0", confirmed: true } },
      { connectionsDir, stateDir, commandRunner: runner }
    );
    const recoveryState = await readFile(path.join(stateDir, "state.json"), "utf8");
    runner.failDown = true;

    await expect(
      executeNetworkManagerHelperRequest(
        { action: "stop_hotspot", input: { device: "wlan0", confirmed: true } },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "operation_failed" });
    expect(await readFile(path.join(stateDir, "state.json"), "utf8")).toBe(recoveryState);
  });

  it("removes a new hotspot file when NetworkManager cannot load it", async () => {
    runner.failLoad = true;

    await expect(
      executeNetworkManagerHelperRequest(
        {
          action: "update_hotspot",
          input: {
            device: "wlan0",
            ssid: "SigmaOS",
            password: "hotspot-password",
            band: "2.4",
            channel: 6,
            autostart: false,
            confirmed: false
          }
        },
        { connectionsDir, stateDir, commandRunner: runner }
      )
    ).rejects.toMatchObject({ code: "operation_failed", rollback: "succeeded" });

    await expect(readdir(connectionsDir)).resolves.toEqual([]);
    expect(runner.calls).toContain("nmcli connection reload");
  });

  it("stops a hotspot without changing its autostart setting", async () => {
    await executeNetworkManagerHelperRequest(
      {
        action: "update_hotspot",
        input: {
          device: "wlan0",
          ssid: "SigmaOS",
          password: "hotspot-password",
          band: "2.4",
          channel: 6,
          autostart: true,
          confirmed: false
        }
      },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    await executeNetworkManagerHelperRequest(
      { action: "stop_hotspot", input: { device: "wlan0", confirmed: true } },
      { connectionsDir, stateDir, commandRunner: runner }
    );

    const inspection = await inspectNetworkManagerProfiles({ connectionsDir, stateDir });
    expect(inspection.profiles[0]?.autoconnect).toBe(true);
    expect(runner.calls.some((call) => call.includes("connection modify"))).toBe(false);
  });
});

class FakeNetworkManagerRunner implements HelperCommandRunner {
  calls: string[] = [];
  scanOutput = "";
  activeUuid: string | null = null;
  failProfileId: string | null = null;
  failLoad = false;
  failDown = false;
  profileType = "wifi";
  profileMode = "infrastructure";

  async run(command: string, args: string[]): Promise<string> {
    const call = [command, ...args].join(" ");
    this.calls.push(call);
    if (command !== "nmcli") return "";
    if (args.includes("RUNNING")) return "running\n";
    if (args.includes("GENERAL.TYPE")) return `${args.at(-1) === "wlan0" ? "wifi" : "ethernet"}\n`;
    if (args.includes("GENERAL.CON-UUID")) return `${this.activeUuid ?? "--"}\n`;
    if (args.includes("connection.type,802-11-wireless.mode")) return `${this.profileType}\n${this.profileMode}\n`;
    if (args.includes("--active")) return this.activeUuid ? `${this.activeUuid}\n` : "";
    if (args.includes("--offline")) {
      const name = args[args.indexOf("con-name") + 1] ?? "SigmaOS";
      const ssid = (args[args.indexOf("ssid") + 1] ?? "SigmaOS").replaceAll(":", "\\:");
      return [
        "[connection]",
        `id=${name}`,
        `uuid=${crypto.randomUUID()}`,
        "type=wifi",
        "",
        "[wifi]",
        "mode=infrastructure",
        `ssid=${ssid}`,
        "",
        "[ipv4]",
        "method=auto",
        "",
        "[ipv6]",
        "method=auto",
        ""
      ].join("\n");
    }
    if (args.includes("list") && args.includes("--rescan")) return this.scanOutput;
    if (args[0] === "connection" && args[1] === "load" && this.failLoad) throw new Error("load failed");
    if (args[0] === "connection" && args[1] === "up") {
      const id = args[3];
      if (id === this.failProfileId) throw new Error("activation failed");
      this.activeUuid = id ?? null;
    }
    if (args[0] === "device" && args[1] === "disconnect") this.activeUuid = null;
    if (args[0] === "connection" && args[1] === "down") {
      if (this.failDown) throw new Error("deactivation failed");
      this.activeUuid = null;
    }
    return "";
  }
}

async function createHotspot(
  connectionsDir: string,
  stateDir: string,
  runner: HelperCommandRunner
): Promise<void> {
  await executeNetworkManagerHelperRequest(
    {
      action: "update_hotspot",
      input: {
        device: "wlan0",
        ssid: "SigmaOS",
        password: "hotspot-password",
        band: "2.4",
        channel: 6,
        autostart: false,
        confirmed: false
      }
    },
    { connectionsDir, stateDir, commandRunner: runner }
  );
}

function managedClientKeyfile(id: string, ssid: string): string {
  return [
    "[connection]",
    `id=SigmaOS ${ssid}`,
    `uuid=${id}`,
    "type=wifi",
    "interface-name=wlan0",
    "autoconnect=true",
    "",
    "[wifi]",
    "mode=infrastructure",
    `ssid=${ssid}`,
    "",
    "[wifi-security]",
    "key-mgmt=wpa-psk",
    "psk=correct-password",
    ""
  ].join("\n");
}

function managedOpenClientKeyfile(id: string, ssid: string): string {
  return [
    "[connection]",
    `id=SigmaOS ${ssid}`,
    `uuid=${id}`,
    "type=wifi",
    "interface-name=wlan0",
    "autoconnect=true",
    "",
    "[wifi]",
    "mode=infrastructure",
    `ssid=${ssid}`,
    ""
  ].join("\n");
}

const TEST_PROFILE_ID = "12345678-1234-4123-8123-123456789abc";
const PREVIOUS_PROFILE_ID = "87654321-4321-4321-8321-cba987654321";
