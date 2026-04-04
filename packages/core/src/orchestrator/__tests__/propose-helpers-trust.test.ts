// packages/core/src/orchestrator/__tests__/propose-helpers-trust.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveEffectiveIdentity } from "../propose-helpers.js";
import type { SharedContext } from "../shared-context.js";
import type { TrustScoreAdapter } from "../../marketplace/trust-adapter.js";
import type { ResolvedIdentity } from "../../identity/spec.js";

function makeMinimalContext(overrides?: Partial<SharedContext>): SharedContext {
  const identitySpec = {
    id: "spec_1",
    principalId: "agent_1",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    spendLimits: { perAction: null, hourly: null, daily: null, monthly: null },
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    storage: {
      identity: {
        getSpecByPrincipalId: vi.fn().mockResolvedValue(identitySpec),
        listOverlaysBySpecId: vi.fn().mockResolvedValue([]),
      },
    } as never,
    ledger: {} as never,
    guardrailState: {} as never,
    guardrailStateStore: null,
    routingConfig: {} as never,
    competenceTracker: null,
    trustAdapter: null,
    riskPostureStore: null,
    governanceProfileStore: null,
    policyCache: null,
    executionMode: "inline" as const,
    onEnqueue: null,
    approvalNotifier: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
    crossCartridgeEnricher: null,
    dataFlowExecutor: null,
    credentialResolver: null,
    circuitBreaker: null,
    idempotencyGuard: null,
    ...overrides,
  };
}

describe("resolveEffectiveIdentity with trustAdapter", () => {
  it("applies trust adjustments when adapter is present", async () => {
    const mockAdapter: TrustScoreAdapter = {
      adjustIdentity: vi
        .fn()
        .mockImplementation(
          async (_principalId: string, _actionType: string, identity: ResolvedIdentity) => ({
            ...identity,
            effectiveRiskTolerance: {
              ...identity.effectiveRiskTolerance,
              low: "none",
              medium: "none",
            },
          }),
        ),
      recordApproval: vi.fn(),
      recordRejection: vi.fn(),
    } as unknown as TrustScoreAdapter;

    const ctx = makeMinimalContext({ trustAdapter: mockAdapter });
    const result = await resolveEffectiveIdentity(ctx, "agent_1", "email-cartridge", "send_email");

    expect(mockAdapter.adjustIdentity).toHaveBeenCalledWith(
      "agent_1",
      "send_email",
      expect.any(Object),
    );
    expect(result.effectiveIdentity.effectiveRiskTolerance.medium).toBe("none");
  });

  it("skips trust adjustments when adapter is null", async () => {
    const ctx = makeMinimalContext({ trustAdapter: null });
    const result = await resolveEffectiveIdentity(ctx, "agent_1", "email-cartridge", "send_email");

    expect(result.effectiveIdentity.effectiveRiskTolerance.medium).toBe("standard");
  });

  it("applies trust adjustments after competence adjustments", async () => {
    const mockAdapter: TrustScoreAdapter = {
      adjustIdentity: vi
        .fn()
        .mockImplementation(
          async (_principalId: string, _actionType: string, identity: ResolvedIdentity) => identity,
        ),
      recordApproval: vi.fn(),
      recordRejection: vi.fn(),
    } as unknown as TrustScoreAdapter;

    const mockTracker = {
      getAdjustment: vi.fn().mockResolvedValue({
        actionType: "send_email",
        score: 85,
        shouldTrust: true,
        shouldEscalate: false,
      }),
    };

    const ctx = makeMinimalContext({
      trustAdapter: mockAdapter,
      competenceTracker: mockTracker as never,
    });

    await resolveEffectiveIdentity(ctx, "agent_1", "email-cartridge", "send_email");

    // Trust adapter should receive the ALREADY competence-adjusted identity
    const adjustIdentityCall = (mockAdapter.adjustIdentity as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(adjustIdentityCall).toBeDefined();
    const identityPassedToAdapter = adjustIdentityCall?.[2] as ResolvedIdentity;
    expect(identityPassedToAdapter.effectiveTrustBehaviors).toContain("send_email");
  });

  it("continues without trust adjustments if adapter throws", async () => {
    const mockAdapter: TrustScoreAdapter = {
      adjustIdentity: vi.fn().mockRejectedValue(new Error("connection timeout")),
      recordApproval: vi.fn(),
      recordRejection: vi.fn(),
    } as unknown as TrustScoreAdapter;

    const ctx = makeMinimalContext({ trustAdapter: mockAdapter });

    // Should not throw — gracefully degrades
    const result = await resolveEffectiveIdentity(ctx, "agent_1", "email-cartridge", "send_email");
    expect(result.effectiveIdentity.effectiveRiskTolerance.medium).toBe("standard");
  });
});
