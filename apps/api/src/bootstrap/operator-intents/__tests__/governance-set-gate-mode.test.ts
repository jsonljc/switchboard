import { describe, it, expect, vi } from "vitest";
import {
  buildGovernanceSetGateModeHandler,
  type GovernanceSetGateModeDeps,
} from "../governance-set-gate-mode.js";
import { DeploymentNotFoundError, GovernanceConfigInvalidError } from "@switchboard/db";
import type { WorkUnit } from "@switchboard/core/platform";

const present = { approvedPriceCount: 3, approvedClaimCount: 2, approvedTemplateCount: 1 };
const absent = { approvedPriceCount: 0, approvedClaimCount: 0, approvedTemplateCount: 0 };

function makeDeps(over: Partial<GovernanceSetGateModeDeps> = {}): GovernanceSetGateModeDeps {
  return {
    writer: { setGateMode: vi.fn().mockResolvedValue({ id: "dep-1" }) },
    probeProducers: vi.fn().mockResolvedValue(present),
    ...over,
  };
}

function wu(parameters: Record<string, unknown>, organizationId = "org-1"): WorkUnit {
  return { organizationId, parameters } as unknown as WorkUnit;
}

describe("buildGovernanceSetGateModeHandler", () => {
  it("REFUSES an enforce flip when the gate's producer is empty (safety invariant) and never writes", async () => {
    const deps = makeDeps({ probeProducers: vi.fn().mockResolvedValue(absent) });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "deterministic", mode: "enforce" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("GATE_NOT_ENFORCE_READY");
    expect(res.error?.message).toMatch(/price/i);
    expect(deps.writer.setGateMode).not.toHaveBeenCalled();
  });

  it("ALLOWS an enforce flip once the gate's producer is populated", async () => {
    const deps = makeDeps();
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "deterministic", mode: "enforce" }),
    );
    expect(res.outcome).toBe("completed");
    expect(deps.writer.setGateMode).toHaveBeenCalledWith({
      organizationId: "org-1",
      deploymentId: "dep-1",
      unit: "deterministic",
      mode: "enforce",
    });
  });

  it("ALLOWS consent enforce even with zero producers (fail-safe gate)", async () => {
    const deps = makeDeps({ probeProducers: vi.fn().mockResolvedValue(absent) });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "consent", mode: "enforce" }),
    );
    expect(res.outcome).toBe("completed");
    expect(deps.writer.setGateMode).toHaveBeenCalled();
  });

  it("NEVER readiness-gates a rollback to observe (even with empty producers, no probe call)", async () => {
    const deps = makeDeps({ probeProducers: vi.fn().mockResolvedValue(absent) });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "deterministic", mode: "observe" }),
    );
    expect(res.outcome).toBe("completed");
    expect(deps.probeProducers).not.toHaveBeenCalled();
    expect(deps.writer.setGateMode).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "observe" }),
    );
  });

  it("NEVER readiness-gates off", async () => {
    const deps = makeDeps({ probeProducers: vi.fn().mockResolvedValue(absent) });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "claims", mode: "off" }),
    );
    expect(res.outcome).toBe("completed");
    expect(deps.probeProducers).not.toHaveBeenCalled();
  });

  it("maps DeploymentNotFoundError to a failed DEPLOYMENT_NOT_FOUND outcome", async () => {
    const deps = makeDeps({
      writer: { setGateMode: vi.fn().mockRejectedValue(new DeploymentNotFoundError("dep-1")) },
    });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "consent", mode: "enforce" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("DEPLOYMENT_NOT_FOUND");
  });

  it("maps GovernanceConfigInvalidError to a failed GOVERNANCE_CONFIG_INVALID outcome", async () => {
    const deps = makeDeps({
      writer: {
        setGateMode: vi.fn().mockRejectedValue(new GovernanceConfigInvalidError("dep-1")),
      },
    });
    const res = await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "consent", mode: "observe" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("GOVERNANCE_CONFIG_INVALID");
  });

  it("rethrows an unexpected infra error (surfaces as a 500 via ingress)", async () => {
    const deps = makeDeps({
      writer: { setGateMode: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await expect(
      buildGovernanceSetGateModeHandler(deps).execute(
        wu({ deploymentId: "dep-1", unit: "consent", mode: "observe" }),
      ),
    ).rejects.toThrow("db down");
  });

  it("uses the AUTHENTICATED org from the work unit for both the probe and the write (org scope)", async () => {
    const deps = makeDeps();
    await buildGovernanceSetGateModeHandler(deps).execute(
      wu({ deploymentId: "dep-1", unit: "deterministic", mode: "enforce" }, "org-XYZ"),
    );
    expect(deps.probeProducers).toHaveBeenCalledWith("org-XYZ", "dep-1");
    expect(deps.writer.setGateMode).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-XYZ" }),
    );
  });
});
