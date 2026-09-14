import { describe, expect, it } from "vitest";
import { initialVmCreateForm, validateVmCreateStep } from "./vm-create-form.js";

const t = (key: string) => key;

describe("VM create form", () => {
  it("uses safe defaults and accepts a complete ISO configuration", () => {
    const form = { ...initialVmCreateForm("default"), name: "home-lab", isoPath: "images/ubuntu.iso" };
    expect(form).toMatchObject({ vcpu: "2", memoryGiB: "2", diskBus: "virtio", networkModel: "virtio", firmware: "bios" });
    expect(validateVmCreateStep(4, form, t)).toBeNull();
  });

  it("blocks incomplete stages and inconsistent topology", () => {
    const empty = initialVmCreateForm();
    expect(validateVmCreateStep(1, empty, t)).toContain("validationName");
    const topology = { ...empty, name: "guest", customTopology: true, vcpu: "4", sockets: "1", cores: "1", threads: "1" };
    expect(validateVmCreateStep(2, topology, t)).toContain("validationTopology");
    expect(validateVmCreateStep(3, { ...topology, customTopology: false }, t)).toContain("validationMedia");
  });

  it("validates custom CPU models and MAC addresses", () => {
    const base = { ...initialVmCreateForm(), name: "guest", isoPath: "installer.iso" };
    expect(validateVmCreateStep(2, { ...base, cpuMode: "custom" }, t)).toContain("validationCpuModel");
    expect(validateVmCreateStep(3, { ...base, macAddress: "not-a-mac" }, t)).toContain("validationMac");
  });
});
