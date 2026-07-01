import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { GovernanceGateInterface, PlatformIngressConfig } from "../platform-ingress.js";
import type { WorkTraceStore } from "../work-trace-recorder.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { ExecutionResult } from "../execution-result.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import type { ExecutionMode } from "../execution-context.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";
import type { WorkTrace } from "../work-trace.js";
import type { WorkOutcome } from "../types.js";
import type { OrganizationEntitlement } from "../../billing/index.js";

const testConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided",
};

const testRegistration: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "skill",
  allowedModes: ["skill"],
  executor: { mode: "skill", skillSlug: "pause-campaign" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "standard",
  approvalPolicy: "none",
  idempotent: false,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 30000,
  retryable: false,
};

const baseRequest: CanonicalSubmitRequest = {
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  trigger: "chat",
  surface: {
    surface: "chat",
    requestId: "req-base",
  },
};

function buildExecuteDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0.2,
    budgetProfile: "standard",
    constraints: testConstraints,
    matchedPolicies: ["default-policy"],
  };
}

function buildDenyDecision(): GovernanceDecision {
  return {
    outcome: "deny",
    reasonCode: "BUDGET_EXCEEDED",
    riskScore: 0.9,
    matchedPolicies: ["budget-limit"],
  };
}

function buildApprovalDecision(): GovernanceDecision {
  return {
    outcome: "require_approval",
    riskScore: 0.6,
    approvalLevel: "manager",
    approvers: ["mgr-1"],
    constraints: testConstraints,
    matchedPolicies: ["approval-required"],
  };
}

function createMockMode(): ExecutionMode {
  return {
    name: "skill",
    execute: vi.fn().mockResolvedValue({
      workUnitId: "mock",
      outcome: "completed",
      summary: "Done",
      outputs: { result: true },
      mode: "skill",
      durationMs: 100,
      traceId: "mock-trace",
    } satisfies ExecutionResult),
  };
}

function createConfig(
  overrides: {
    decision?: GovernanceDecision;
    governanceThrows?: boolean;
    traceStore?: WorkTraceStore;
    mode?: ExecutionMode;
    resolveDeployment?: ReturnType<typeof vi.fn>;
  } = {},
): PlatformIngressConfig {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(testRegistration);

  const modeRegistry = new ExecutionModeRegistry();
  const mode = overrides.mode ?? createMockMode();
  modeRegistry.register(mode);

  const governanceGate: GovernanceGateInterface = {
    evaluate: overrides.governanceThrows
      ? vi.fn().mockRejectedValue(new Error("boom"))
      : vi.fn().mockResolvedValue(overrides.decision ?? buildExecuteDecision()),
  };

  return {
    intentRegistry,
    modeRegistry,
    governanceGate,
    deploymentResolver: {
      resolve:
        overrides.resolveDeployment ??
        vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          skillSlug: "test-skill",
          trustLevel: "guided",
          trustScore: 42,
        }),
    },
    traceStore: overrides.traceStore,
  };
}

/**
 * An in-memory WorkTraceStore with a real org-scoped idempotency lookup, so a
 * park-then-replay round-trip exercises the actual cached-replay branch (not a
 * hand-built trace fixture). Mirrors the production store's contract closely
 * enough for the ingress: persist/claim index by (organizationId, idempotencyKey).
 */
function inMemoryTraceStore(): WorkTraceStore {
  const byKey = new Map<string, WorkTrace>();
  const byWorkUnit = new Map<string, WorkTrace>();
  const keyOf = (orgId: string, key: string): string => `${orgId}::${key}`;
  return {
    persist: async (trace) => {
      byWorkUnit.set(trace.workUnitId, trace);
      if (trace.idempotencyKey) {
        byKey.set(keyOf(trace.organizationId, trace.idempotencyKey), trace);
      }
    },
    claim: async (trace) => {
      const k = trace.idempotencyKey ? keyOf(trace.organizationId, trace.idempotencyKey) : null;
      if (k && byKey.has(k)) return { claimed: false };
      byWorkUnit.set(trace.workUnitId, trace);
      if (k) byKey.set(k, trace);
      return { claimed: true };
    },
    getByWorkUnitId: async (id) => {
      const trace = byWorkUnit.get(id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id, fields) => {
      const existing = byWorkUnit.get(id);
      if (!existing) {
        return { ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: "not found" };
      }
      const merged: WorkTrace = { ...existing, ...fields };
      byWorkUnit.set(id, merged);
      if (merged.idempotencyKey) {
        byKey.set(keyOf(merged.organizationId, merged.idempotencyKey), merged);
      }
      return { ok: true, trace: merged };
    },
    getByIdempotencyKey: async (organizationId, key) => {
      const trace = byKey.get(keyOf(organizationId, key));
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  };
}

/**
 * A minimal resolved (non-pending_approval) trace the replay branch can rebuild a
 * response from. Only the fields the replay reads are populated; the rest of the
 * WorkTrace is irrelevant to the cached-replay path.
 */
function resolvedTraceFixture(
  outcome: WorkOutcome,
  ingressPath: WorkTrace["ingressPath"] = "platform_ingress",
): WorkTrace {
  return {
    workUnitId: "wu-replay",
    outcome,
    executionSummary: "prior result",
    executionOutputs: { ran: true },
    mode: "skill",
    durationMs: 5,
    traceId: "trace-replay",
    error: outcome === "failed" ? { code: "X", message: "m" } : undefined,
    organizationId: "org-1",
    requestedAt: "2026-06-01T00:00:00.000Z",
    actor: { id: "user-1", type: "user" },
    intent: "campaign.pause",
    parameters: { campaignId: "camp-123" },
    deploymentContext: { deploymentId: "dep-1", skillSlug: "test-skill" },
    trigger: "chat",
    idempotencyKey: "k-resolved",
    ingressPath,
  } as unknown as WorkTrace;
}

describe("PlatformIngress - idempotency replay after de-entitlement (GOV-9)", () => {
  const entitledNow = (): OrganizationEntitlement => ({ entitled: true, reason: "active" });
  const blockedNow = (): OrganizationEntitlement => ({
    entitled: false,
    reason: "blocked",
    blockedStatus: "canceled",
  });

  it("replays a previously-authorized request from cache even after the org is de-entitled", async () => {
    // Pins the intentional ordering in platform-ingress.ts: the idempotency replay
    // runs BEFORE the entitlement check, so a replay of an already-authorized
    // mutation returns the identical cached response even once the org has become
    // unentitled. The first submission was authorized at the time; idempotency
    // guarantees identical replay; entitlement gates only NEW (non-cached) submits.
    let entitled = true;
    const resolveSpy = vi.fn(async () => (entitled ? entitledNow() : blockedNow()));
    const config: PlatformIngressConfig = {
      ...createConfig({ traceStore: inMemoryTraceStore() }),
      entitlementResolver: { resolve: resolveSpy },
    };
    const ingress = new PlatformIngress(config);
    const request = { ...baseRequest, idempotencyKey: "k-deent" };

    // 1) First submission while entitled: passes the gate, executes, caches a keyed trace.
    const first = await ingress.submit(request);
    expect(first.ok).toBe(true);

    // 2) Org is de-entitled; the SAME idempotency key is replayed.
    entitled = false;
    const replay = await ingress.submit(request);

    // The cached result is returned, NOT entitlement_required...
    expect(replay.ok).toBe(true);
    // ...and entitlement was consulted ONLY on the first (non-cached) submission:
    // the replay short-circuited before the entitlement gate (the pinned ordering).
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PlatformIngress", () => {
  it("returns IngressError for unknown intent", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({ ...baseRequest, intent: "unknown.action" });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.type).toBe("intent_not_found");
      expect(response.error.intent).toBe("unknown.action");
    }
  });

  it("returns IngressError for disallowed trigger", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({ ...baseRequest, trigger: "schedule" });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.type).toBe("trigger_not_allowed");
      expect(response.error.intent).toBe("campaign.pause");
    }
  });

  it("returns deny result when governance denies", async () => {
    const config = createConfig({ decision: buildDenyDecision() });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("failed");
      expect(response.result.error?.code).toBe("BUDGET_EXCEEDED");
    }
  });

  it("returns pending_approval when governance requires approval", async () => {
    const config = createConfig({ decision: buildApprovalDecision() });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pending_approval");
      expect("approvalRequired" in response && response.approvalRequired).toBe(true);
    }
  });

  it("dispatches to correct mode and returns completed result", async () => {
    const mode = createMockMode();
    const config = createConfig({ mode });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("completed");
      expect(response.result.outputs).toEqual({ result: true });
      expect(mode.execute).toHaveBeenCalledOnce();
    }
  });

  it("persists WorkTrace on successful execution", async () => {
    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue({ claimed: true }),
      getByWorkUnitId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ok: true, trace: {} as never }),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    const config = createConfig({ traceStore });
    const ingress = new PlatformIngress(config);

    await ingress.submit(baseRequest);

    expect(traceStore.persist).toHaveBeenCalledOnce();
    const trace = vi.mocked(traceStore.persist).mock.calls[0]![0];
    expect(trace.outcome).toBe("completed");
    expect(trace.governanceOutcome).toBe("execute");
    expect(trace.intent).toBe("campaign.pause");
  });

  it("scopes the idempotency replay lookup by organizationId (cross-tenant safety)", async () => {
    const getByIdempotencyKey = vi.fn().mockResolvedValue(null);
    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue({ claimed: true }),
      getByWorkUnitId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ok: true, trace: {} as never }),
      getByIdempotencyKey,
    };
    const config = createConfig({ traceStore });
    const ingress = new PlatformIngress(config);

    await ingress.submit({ ...baseRequest, idempotencyKey: "key-1" });

    // The replay lookup MUST be org-scoped so a key reused across tenants cannot
    // return another org's cached WorkTrace (cross-tenant disclosure).
    expect(getByIdempotencyKey).toHaveBeenCalledWith("org-1", "key-1");
  });

  it("persists WorkTrace on governance deny", async () => {
    const traceStore: WorkTraceStore = {
      persist: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue({ claimed: true }),
      getByWorkUnitId: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ok: true, trace: {} as never }),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };
    const config = createConfig({ decision: buildDenyDecision(), traceStore });
    const ingress = new PlatformIngress(config);

    await ingress.submit(baseRequest);

    expect(traceStore.persist).toHaveBeenCalledOnce();
    const trace = vi.mocked(traceStore.persist).mock.calls[0]![0];
    expect(trace.outcome).toBe("failed");
    expect(trace.governanceOutcome).toBe("deny");
  });

  it("normalizes WorkUnit with generated id and traceId", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.workUnit.id).toBeDefined();
      expect(response.workUnit.id.length).toBeGreaterThan(0);
      expect(response.workUnit.traceId).toBeDefined();
      expect(response.workUnit.traceId.length).toBeGreaterThan(0);
      expect(response.workUnit.resolvedMode).toBe("skill");
      expect(response.workUnit.organizationId).toBe("org-1");
    }
  });

  it("passes suggestedMode through to resolveMode", async () => {
    const config = createConfig();
    const ingress = new PlatformIngress(config);
    const resolveSpy = vi.spyOn(config.intentRegistry, "resolveMode");

    const response = await ingress.submit({ ...baseRequest, suggestedMode: "pipeline" });

    expect(resolveSpy).toHaveBeenCalledWith("campaign.pause", "pipeline");
    // pipeline is not in allowedModes for this registration, so resolveMode falls back to default
    expect(response.ok).toBe(true);
  });

  it("returns IngressError when deployment resolution fails", async () => {
    const resolveDeployment = vi.fn().mockRejectedValue(new Error("no deployment found"));
    const config = createConfig({ resolveDeployment });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.type).toBe("deployment_not_found");
      expect(response.error.intent).toBe("campaign.pause");
      expect(response.error.message).toContain("no deployment found");
    }
  });

  it("creates lifecycle atomically when lifecycleService is provided and governance requires approval", async () => {
    const mockLifecycleService = {
      createGatedLifecycle: vi.fn().mockResolvedValue({
        lifecycle: {
          id: "lc-1",
          actionEnvelopeId: "env-1",
          status: "pending",
          currentRevisionId: "rev-1",
          version: 1,
        },
        revision: {
          id: "rev-1",
          bindingHash: "a".repeat(64),
          revisionNumber: 1,
        },
      }),
    };

    const config = createConfig({ decision: buildApprovalDecision() });
    config.lifecycleService = mockLifecycleService as never;
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);

    expect(response.ok).toBe(true);
    if (response.ok && "approvalRequired" in response) {
      expect(response.approvalRequired).toBe(true);
      expect(response.lifecycleId).toBe("lc-1");
      expect(response.bindingHash).toBe("a".repeat(64));
    }
    expect(mockLifecycleService.createGatedLifecycle).toHaveBeenCalledOnce();
    const input = mockLifecycleService.createGatedLifecycle.mock.calls[0]![0];
    expect(input.initialRevision.parametersSnapshot).toEqual({ campaignId: "camp-123" });
    expect(input.initialRevision.createdBy).toBe("user-1");
  });

  it("resolves deployment inside PlatformIngress from canonical request fields", async () => {
    const resolveDeployment = vi.fn().mockResolvedValue({
      deploymentId: "dep-resolved",
      skillSlug: "pause-campaign",
      trustLevel: "guided",
      trustScore: 42,
    });
    const config = createConfig({
      resolveDeployment,
    });
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit({
      organizationId: "org-1",
      actor: { id: "user-1", type: "user" },
      intent: "campaign.pause",
      parameters: { campaignId: "camp-123" },
      trigger: "api",
      surface: {
        surface: "api",
        requestId: "req-1",
      },
      targetHint: {
        skillSlug: "pause-campaign",
      },
    });

    expect(resolveDeployment).toHaveBeenCalledOnce();
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.workUnit.deployment.deploymentId).toBe("dep-resolved");
      expect(response.workUnit.traceId.length).toBeGreaterThan(0);
    }
  });

  describe("idempotent replay reconstructs the approval marker (D5-3/D4-1)", () => {
    it("a pending_approval replay returns approvalRequired:true, like the first park", async () => {
      const traceStore = inMemoryTraceStore();
      const config = createConfig({ decision: buildApprovalDecision(), traceStore });
      const ingress = new PlatformIngress(config);
      const keyed: CanonicalSubmitRequest = {
        ...baseRequest,
        idempotencyKey: "mutate:riley:rec_1:pause",
      };

      // First submit: the genuine park persists a pending_approval trace.
      const first = await ingress.submit(keyed);
      expect(first.ok).toBe(true);
      expect("approvalRequired" in first && first.approvalRequired).toBe(true);

      // Second submit (same key): the idempotent replay (e.g. a weekly-cron retry).
      // It MUST carry the same approval marker the first park returned, so an
      // approval-aware consumer classifies it as parked, not as a phantom execution.
      const second = await ingress.submit(keyed);
      expect(second.ok).toBe(true);
      expect("approvalRequired" in second && second.approvalRequired).toBe(true);
      if (second.ok) expect(second.result.outcome).toBe("pending_approval");
    });

    it.each(["completed", "failed", "queued"] as const)(
      "a %s replay stays marker-free and shape-identical (marker scoped to pending_approval)",
      async (outcome) => {
        const trace = resolvedTraceFixture(outcome);
        const traceStore: WorkTraceStore = {
          persist: vi.fn().mockResolvedValue(undefined),
          claim: vi.fn().mockResolvedValue({ claimed: true }),
          getByWorkUnitId: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue({ ok: true, trace: {} as never }),
          getByIdempotencyKey: vi.fn().mockResolvedValue({ trace, integrity: { status: "ok" } }),
        };
        const config = createConfig({ traceStore });
        const ingress = new PlatformIngress(config);

        const res = await ingress.submit({ ...baseRequest, idempotencyKey: "k-resolved" });

        expect(res.ok).toBe(true);
        // The marker is reconstructed ONLY for pending_approval; resolved outcomes
        // replay unchanged (no approvalRequired key at all).
        expect("approvalRequired" in res).toBe(false);
        if (res.ok) {
          expect(res.result.outcome).toBe(outcome);
          expect(res.workUnit.idempotencyKey).toBe("k-resolved");
        }
      },
    );

    it("a non-ingress pending_approval replay (recommendation emission mirror row) is NOT marked", async () => {
      // The emission mirror persists a KEYED pending_approval WorkTrace with ingressPath
      // "agent_recommendation_emission". Only a platform_ingress park may be re-marked, so
      // this replay must NOT carry approvalRequired even though the outcome matches.
      const trace = resolvedTraceFixture("pending_approval", "agent_recommendation_emission");
      const traceStore: WorkTraceStore = {
        persist: vi.fn().mockResolvedValue(undefined),
        claim: vi.fn().mockResolvedValue({ claimed: true }),
        getByWorkUnitId: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ ok: true, trace: {} as never }),
        getByIdempotencyKey: vi.fn().mockResolvedValue({ trace, integrity: { status: "ok" } }),
      };
      const config = createConfig({ traceStore });
      const ingress = new PlatformIngress(config);

      const res = await ingress.submit({ ...baseRequest, idempotencyKey: "k-resolved" });

      expect(res.ok).toBe(true);
      expect("approvalRequired" in res).toBe(false);
      if (res.ok) expect(res.result.outcome).toBe("pending_approval");
    });
  });
});
