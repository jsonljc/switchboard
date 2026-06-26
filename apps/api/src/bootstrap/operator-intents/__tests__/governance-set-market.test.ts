import { describe, it, expect, vi } from "vitest";
import {
  buildGovernanceSetMarketHandler,
  type GovernanceSetMarketDeps,
} from "../governance-set-market.js";
import { DeploymentNotFoundError, GovernanceConfigInvalidError } from "@switchboard/db";
import type { WorkUnit } from "@switchboard/core/platform";

function makeDeps(over: Partial<GovernanceSetMarketDeps> = {}): GovernanceSetMarketDeps {
  return {
    writer: { setMarket: vi.fn().mockResolvedValue({ id: "dep-1" }) },
    ...over,
  };
}

function wu(parameters: Record<string, unknown>, organizationId = "org-1"): WorkUnit {
  return { organizationId, parameters } as unknown as WorkUnit;
}

describe("buildGovernanceSetMarketHandler", () => {
  it("writes the market and completes (no readiness gate — market is a declaration)", async () => {
    const deps = makeDeps();
    const res = await buildGovernanceSetMarketHandler(deps).execute(
      wu({ deploymentId: "dep-1", jurisdiction: "MY", clinicType: "nonMedical" }),
    );
    expect(res.outcome).toBe("completed");
    expect(deps.writer.setMarket).toHaveBeenCalledWith({
      organizationId: "org-1",
      deploymentId: "dep-1",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });
  });

  it("uses the AUTHENTICATED org from the work unit, never a param (org scope)", async () => {
    const deps = makeDeps();
    await buildGovernanceSetMarketHandler(deps).execute(
      wu({ deploymentId: "dep-1", jurisdiction: "SG", clinicType: "medical" }, "org-XYZ"),
    );
    expect(deps.writer.setMarket).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-XYZ" }),
    );
  });

  it("rejects invalid params (unknown jurisdiction) before any write", async () => {
    const deps = makeDeps();
    await expect(
      buildGovernanceSetMarketHandler(deps).execute(
        wu({ deploymentId: "dep-1", jurisdiction: "TH", clinicType: "medical" }),
      ),
    ).rejects.toThrow();
    expect(deps.writer.setMarket).not.toHaveBeenCalled();
  });

  it("maps DeploymentNotFoundError to a failed DEPLOYMENT_NOT_FOUND outcome", async () => {
    const deps = makeDeps({
      writer: { setMarket: vi.fn().mockRejectedValue(new DeploymentNotFoundError("dep-1")) },
    });
    const res = await buildGovernanceSetMarketHandler(deps).execute(
      wu({ deploymentId: "dep-1", jurisdiction: "MY", clinicType: "medical" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("DEPLOYMENT_NOT_FOUND");
  });

  it("maps GovernanceConfigInvalidError to a failed GOVERNANCE_CONFIG_INVALID outcome", async () => {
    const deps = makeDeps({
      writer: { setMarket: vi.fn().mockRejectedValue(new GovernanceConfigInvalidError("dep-1")) },
    });
    const res = await buildGovernanceSetMarketHandler(deps).execute(
      wu({ deploymentId: "dep-1", jurisdiction: "MY", clinicType: "medical" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("GOVERNANCE_CONFIG_INVALID");
  });

  it("rethrows an unexpected infra error (surfaces as a 500 via ingress)", async () => {
    const deps = makeDeps({
      writer: { setMarket: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await expect(
      buildGovernanceSetMarketHandler(deps).execute(
        wu({ deploymentId: "dep-1", jurisdiction: "MY", clinicType: "medical" }),
      ),
    ).rejects.toThrow("db down");
  });
});
