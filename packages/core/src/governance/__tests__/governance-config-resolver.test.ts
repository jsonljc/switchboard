import { describe, it, expect } from "vitest";
import { createAgentDeploymentGovernanceResolver } from "../governance-config-resolver.js";

describe("createAgentDeploymentGovernanceResolver", () => {
  it("returns missing when the deployment has no governanceConfig", async () => {
    const resolve = createAgentDeploymentGovernanceResolver({
      findById: async () => ({ id: "dep-1", governanceConfig: null }),
    } as never);

    const out = await resolve("dep-1");
    expect(out).toEqual({ status: "missing" });
  });

  it("returns missing when the deployment row does not exist", async () => {
    const resolve = createAgentDeploymentGovernanceResolver({
      findById: async () => null,
    } as never);

    const out = await resolve("nope");
    expect(out).toEqual({ status: "missing" });
  });

  it("returns resolved with parsed config when present", async () => {
    const cfg = {
      jurisdiction: "SG",
      clinicType: "medical",
      deterministicGate: { mode: "enforce" },
    };
    const resolve = createAgentDeploymentGovernanceResolver({
      findById: async () => ({ id: "dep-1", governanceConfig: cfg }),
    } as never);

    const out = await resolve("dep-1");
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.config.deterministicGate.mode).toBe("enforce");
    expect(out.config.jurisdiction).toBe("SG");
  });

  it("returns error when the store throws", async () => {
    const boom = new Error("connection refused");
    const resolve = createAgentDeploymentGovernanceResolver({
      findById: async () => {
        throw boom;
      },
    } as never);

    const out = await resolve("dep-1");
    if (out.status !== "error") throw new Error("expected error");
    expect(out.error).toBe(boom);
  });

  it("returns error when the stored config fails Zod validation", async () => {
    const resolve = createAgentDeploymentGovernanceResolver({
      findById: async () => ({
        id: "dep-1",
        governanceConfig: { jurisdiction: "INVALID", clinicType: "medical" },
      }),
    } as never);

    const out = await resolve("dep-1");
    expect(out.status).toBe("error");
  });
});
