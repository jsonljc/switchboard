// ---------------------------------------------------------------------------
// Tests for resolveAuthoritativeDeployment — the AuthoritativeDeploymentResolver
// wired into PlatformIngress (apps/api/src/app.ts). PlatformIngress consumes this,
// NOT the generic toDeploymentContext mapper, so the SMB launch-posture trust
// override (governanceSettings.trustLevelOverride) must be forwarded HERE to reach
// GovernanceGate. This pins the seam the gate-level unit tests don't exercise.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import type {
  CanonicalSubmitRequest,
  DeploymentResolver,
  DeploymentResolverResult,
} from "@switchboard/core/platform";
import { resolveAuthoritativeDeployment } from "../bootstrap/platform-deployment-resolver.js";

function makeResult(overrides: Partial<DeploymentResolverResult> = {}): DeploymentResolverResult {
  return {
    deploymentId: "dep-1",
    listingId: "list-1",
    organizationId: "org-1",
    skillSlug: "alex",
    trustLevel: "guided",
    trustScore: 0,
    inputConfig: {},
    ...overrides,
  };
}

function makeResolver(result: DeploymentResolverResult): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => result,
    resolveByDeploymentId: async () => result,
    resolveByChannelToken: async () => result,
  };
}

// resolve() only reads organizationId, intent, targetHint.
const REQUEST = {
  organizationId: "org-1",
  intent: "alex.conversation",
} as unknown as CanonicalSubmitRequest;

describe("resolveAuthoritativeDeployment", () => {
  it("forwards trustLevelOverride from the resolved deployment to the context", async () => {
    const authoritative = resolveAuthoritativeDeployment(
      makeResolver(makeResult({ trustLevelOverride: "autonomous" })),
    );

    const ctx = await authoritative.resolve(REQUEST);

    // This is the seam: if the override is dropped here, GovernanceGate never
    // sees it and the auto-allow posture is inert in production.
    expect(ctx.trustLevelOverride).toBe("autonomous");
    // The score-derived trustLevel is still passed through unchanged.
    expect(ctx.trustLevel).toBe("guided");
  });

  it("leaves trustLevelOverride undefined when the deployment has no override", async () => {
    const authoritative = resolveAuthoritativeDeployment(makeResolver(makeResult()));

    const ctx = await authoritative.resolve(REQUEST);

    expect(ctx.trustLevelOverride).toBeUndefined();
  });

  it("returns the platform-direct fallback (no override) when no resolver is wired", async () => {
    const authoritative = resolveAuthoritativeDeployment(null);

    const ctx = await authoritative.resolve(REQUEST);

    expect(ctx.deploymentId).toBe("platform-direct");
    expect(ctx.trustLevel).toBe("supervised");
    expect(ctx.trustLevelOverride).toBeUndefined();
  });

  it("forwards policyOverrides (spendApprovalThreshold) to the context", async () => {
    const authoritative = resolveAuthoritativeDeployment(
      makeResolver(makeResult({ policyOverrides: { spendApprovalThreshold: 250 } })),
    );

    const ctx = await authoritative.resolve(REQUEST);

    // Seam: if policyOverrides is dropped here, GovernanceGate never sees the
    // spend threshold and the autonomy lever is inert in production (#644).
    expect(ctx.policyOverrides?.spendApprovalThreshold).toBe(250);
  });

  it("leaves policyOverrides undefined when the deployment has none", async () => {
    const authoritative = resolveAuthoritativeDeployment(makeResolver(makeResult()));

    const ctx = await authoritative.resolve(REQUEST);

    expect(ctx.policyOverrides).toBeUndefined();
  });

  it("forwards the explicit spendAutonomyEnabled opt-in to the context", async () => {
    const authoritative = resolveAuthoritativeDeployment(
      makeResolver(makeResult({ spendAutonomyEnabled: true })),
    );

    const ctx = await authoritative.resolve(REQUEST);

    // The lever's activation flag must reach the gate; without it the gate cannot
    // distinguish an opted-in deployment from one merely carrying the $50 default.
    expect(ctx.spendAutonomyEnabled).toBe(true);
  });
});
