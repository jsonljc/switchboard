import { describe, it, expect, vi } from "vitest";
import type { GovernanceConfig } from "@switchboard/schemas";
import { buildSafeHarborFloorConfig } from "@switchboard/schemas";
import { resolveVertical } from "./resolve-vertical.js";
import { DEFAULT_VERTICAL } from "../vertical.js";

const base = { jurisdiction: "SG", clinicType: "medical", deterministicGate: { mode: "observe" } };
const withVertical = (v: unknown): GovernanceConfig =>
  ({ ...base, vertical: v }) as unknown as GovernanceConfig;

describe("resolveVertical", () => {
  it("defaults to the seed vertical when no marker is present (byte-identical for existing configs)", () => {
    expect(resolveVertical(base as unknown as GovernanceConfig)).toBe(DEFAULT_VERTICAL);
    expect(DEFAULT_VERTICAL).toBe("medspa");
  });

  it("treats a null config as the default vertical", () => {
    expect(resolveVertical(null)).toBe("medspa");
  });

  it("reads a valid registered marker", () => {
    expect(resolveVertical(withVertical("generic"))).toBe("generic");
    expect(resolveVertical(withVertical("medspa"))).toBe("medspa");
    expect(resolveVertical(withVertical("fitness"))).toBe("fitness");
  });

  it("fails safe to the default vertical on a corrupt marker (and logs)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveVertical(withVertical("wellness-clinic"))).toBe("medspa");
    expect(resolveVertical(withVertical(99))).toBe("medspa");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not log on absence (the normal byte-identical path)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveVertical(base as unknown as GovernanceConfig);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("treats an explicit null marker as absence (default vertical, no log)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveVertical(withVertical(null))).toBe("medspa");
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("floor seam: schemas factory -> core resolver", () => {
  it("resolves the safe-harbor floor config to the generic vertical (SG and MY)", () => {
    expect(resolveVertical(buildSafeHarborFloorConfig({ jurisdiction: "SG" }))).toBe("generic");
    expect(resolveVertical(buildSafeHarborFloorConfig({ jurisdiction: "MY" }))).toBe("generic");
  });
});
