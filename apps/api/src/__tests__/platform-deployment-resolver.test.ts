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
import { ROBIN_RECOVERY_SEND_INTENT } from "../services/workflows/robin-recovery-request.js";

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

  it("resolves the creative deployment from the compose intent prefix (slice-4, no targetHint)", async () => {
    // The slice-4 initiators pass targetHint explicitly, but the prefix
    // fallback must ALSO land on the creative deployment: "creative.brief
    // .compose" splits to "creative", which is Mira's seeded deployment slug.
    let resolvedSlug: string | undefined;
    const result = makeResult({ skillSlug: "creative", deploymentId: "dep-creative" });
    const resolver: DeploymentResolver = {
      resolveByOrgAndSlug: async (_org: string, slug: string) => {
        resolvedSlug = slug;
        return result;
      },
      resolveByDeploymentId: async () => result,
      resolveByChannelToken: async () => result,
    };
    const authoritative = resolveAuthoritativeDeployment(resolver);
    const ctx = await authoritative.resolve({
      organizationId: "org-1",
      intent: "creative.brief.compose",
    } as unknown as CanonicalSubmitRequest);

    expect(resolvedSlug).toBe("creative");
    expect(ctx.deploymentId).toBe("dep-creative");
    expect(ctx.skillSlug).toBe("creative");
  });

  it("resolves operator_mutation intents to platform-direct, bypassing the throwing slug lookup", async () => {
    // Simulate production: the real resolver THROWS for an intent whose prefix has no seeded
    // deployment (e.g. "ledger" / "receipt" / "booking"). Operator mutations are not skill-bound and
    // are system_auto_approved (deployment trust is never consulted), so they must resolve to a
    // platform-direct context instead of failing deployment_not_found and going inert in prod.
    let lookupCalled = false;
    const throwingResolver: DeploymentResolver = {
      resolveByOrgAndSlug: async () => {
        lookupCalled = true;
        throw new Error("No active deployment found for org=org-1 slug=ledger");
      },
      resolveByDeploymentId: async () => makeResult(),
      resolveByChannelToken: async () => makeResult(),
    };
    const authoritative = resolveAuthoritativeDeployment(throwingResolver, {
      isPlatformDirectIntent: (intent) => intent === "ledger.deliver_weekly_report",
    });

    const ctx = await authoritative.resolve({
      organizationId: "org-1",
      intent: "ledger.deliver_weekly_report",
    } as unknown as CanonicalSubmitRequest);

    expect(ctx.deploymentId).toBe("platform-direct");
    expect(ctx.skillSlug).toBe("ledger");
    expect(ctx.trustLevel).toBe("supervised");
    // The strict slug lookup was bypassed entirely (no throw, no deployment_not_found).
    expect(lookupCalled).toBe(false);
  });

  it("resolves robin.recovery_campaign.send to platform-direct (the parking-campaign carve-out)", async () => {
    // Robin has NO seeded deployment by design (it is a capability, not an agent). Without the
    // carve-out the slug "robin" would throw deployment_not_found and ship the gate prod-inert.
    let lookupCalled = false;
    const throwingResolver: DeploymentResolver = {
      resolveByOrgAndSlug: async () => {
        lookupCalled = true;
        throw new Error("No active deployment found for org=org-1 slug=robin");
      },
      resolveByDeploymentId: async () => makeResult(),
      resolveByChannelToken: async () => makeResult(),
    };
    const authoritative = resolveAuthoritativeDeployment(throwingResolver, {
      isPlatformDirectIntent: (intent) => intent === ROBIN_RECOVERY_SEND_INTENT,
    });

    const ctx = await authoritative.resolve({
      organizationId: "org-1",
      intent: ROBIN_RECOVERY_SEND_INTENT,
    } as unknown as CanonicalSubmitRequest);

    expect(ctx.deploymentId).toBe("platform-direct");
    expect(ctx.trustLevel).toBe("supervised");
    expect(lookupCalled).toBe(false);
  });

  it("still resolves skill intents via the deployment lookup when the predicate is false", async () => {
    let resolvedSlug: string | undefined;
    const result = makeResult({ skillSlug: "alex", deploymentId: "dep-alex" });
    const resolver: DeploymentResolver = {
      resolveByOrgAndSlug: async (_org: string, slug: string) => {
        resolvedSlug = slug;
        return result;
      },
      resolveByDeploymentId: async () => result,
      resolveByChannelToken: async () => result,
    };
    const authoritative = resolveAuthoritativeDeployment(resolver, {
      isPlatformDirectIntent: () => false,
    });

    const ctx = await authoritative.resolve({
      organizationId: "org-1",
      intent: "alex.conversation",
    } as unknown as CanonicalSubmitRequest);

    expect(resolvedSlug).toBe("alex");
    expect(ctx.deploymentId).toBe("dep-alex");
  });
});
