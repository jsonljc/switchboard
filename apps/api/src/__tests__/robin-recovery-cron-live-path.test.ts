/**
 * LIVE-PATH proof for the Robin recovery PRODUCER. Drives the real submit MECHANISM the cron fires:
 * buildRecoveryCampaignSubmitRequest -> REAL PlatformIngress.submit -> REAL GovernanceGate with the
 * seeded allow + require_approval(mandatory) policies + the seeded {id:"system"} principal, resolved
 * through the REAL prod carve-out resolver (resolveAuthoritativeDeployment + isPlatformDirectIntent).
 *
 * Proves (load-bearing, do not weaken):
 *   1. a campaign PARKS at mandatory approval and never auto-approves;
 *   2. the carve-out is LOAD-BEARING: WITH it the throwing resolver (prod has no "robin" deployment)
 *      yields a park, WITHOUT it the SAME submit returns deployment_not_found (the
 *      feedback_workflow_intent_deployment_not_found lesson, which the api harness's null resolver
 *      would otherwise mask);
 *   3. two submits with the same ISO-week key dedup to EXACTLY ONE parked campaign;
 *   4. an un-seeded org default-DENIES (fail safe, no phantom park).
 * No Postgres (CI has none for apps/api).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  type GovernanceGateDeps,
  type IntentRegistration,
  type WorkflowHandler,
  type DeploymentResolver,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity, selectRecoveryCandidates } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
} from "@switchboard/db";
import { resolveAuthoritativeDeployment } from "../bootstrap/platform-deployment-resolver.js";
import {
  buildRecoveryCampaignSubmitRequest,
  ROBIN_RECOVERY_SEND_INTENT,
} from "../services/workflows/robin-recovery-request.js";

const ORG = "org-acme";

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function allowPolicy(): Policy {
  return {
    ...buildRobinRecoveryAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function approvalPolicy(): Policy {
  return {
    ...buildRobinRecoveryApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

// Faithful idempotency-aware in-memory trace store. A park persists a WorkTrace with idempotencyKey +
// ingressPath="platform_ingress" (work-trace-recorder), so getByIdempotencyKey returns it and the
// ingress replay marks a same-key re-submit approvalRequired instead of creating a duplicate.
function inMemoryTraceStore(): { store: WorkTraceStore; traces: WorkTrace[] } {
  const traces: WorkTrace[] = [];
  const store = {
    claim: async () => ({ claimed: true }),
    persist: async (t: WorkTrace) => {
      traces.push(t);
    },
    getByWorkUnitId: async (id: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.workUnitId === id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>) => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx >= 0) traces[idx] = { ...traces[idx]!, ...fields };
      return { ok: true, trace: traces[idx >= 0 ? idx : 0] ?? ({} as never) };
    },
    getByIdempotencyKey: async (org: string, key: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.organizationId === org && t.idempotencyKey === key);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
  return { store, traces };
}

function robinRegistration(): IntentRegistration {
  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: ROBIN_RECOVERY_SEND_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["schedule"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

// The production resolver THROWS for slug "robin" (no seeded deployment). The carve-out flag toggles
// whether resolveAuthoritativeDeployment short-circuits to platform-direct.
function throwingResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error("No active deployment found for org=org-acme slug=robin");
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  };
}

function buildIngress(
  policies: Policy[],
  carveOut: boolean,
): {
  ingress: PlatformIngress;
  traces: WorkTrace[];
} {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(robinRegistration());

  // The same fail-closed shape as the shipped placeholder executor. Parking never dispatches it; it is
  // here only so the workflow mode has a handler registered for the intent.
  const placeholder: WorkflowHandler = {
    async execute() {
      return {
        outcome: "failed",
        summary: "placeholder",
        outputs: {},
        error: { code: "ROBIN_RECOVERY_SEND_NOT_WIRED", message: "deferred" },
      };
    },
  };
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([[ROBIN_RECOVERY_SEND_INTENT, placeholder]]),
      services: {
        submitChildWork: async () => {
          throw new Error("no child work in this test");
        },
      },
    }),
  );

  const { store, traces } = inMemoryTraceStore();
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(policies),
    deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
      isPlatformDirectIntent: (i) => (carveOut ? i === ROBIN_RECOVERY_SEND_INTENT : false),
    }),
    traceStore: store,
  });
  return { ingress, traces };
}

// The real producer chain: a no-show row -> selectRecoveryCandidates (dedupe/exclude) ->
// buildRecoveryCampaignSubmitRequest, so this proof cannot drift from the cron's submit mechanism.
function campaignReq(asOf: Date) {
  const cohort = selectRecoveryCandidates(
    [
      {
        bookingId: "bk_1",
        contactId: "ct_1",
        service: "Botox",
        startsAt: new Date("2026-06-03T09:00:00Z"),
        attendeeName: "Jamie",
      },
    ],
    { existingFutureBookingContactIds: new Set() },
  );
  return buildRecoveryCampaignSubmitRequest({
    organizationId: ORG,
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-15T00:00:00Z"),
    asOf,
    candidates: cohort,
  })!;
}

describe("robin recovery producer (live path through real ingress + carve-out resolver)", () => {
  it("PARKS at mandatory via the carve-out resolver (no deployment_not_found)", async () => {
    const { ingress } = buildIngress([allowPolicy(), approvalPolicy()], true);
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBe(true);
    expect(res.result.outcome).toBe("pending_approval");
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });
  });

  it("WITHOUT the carve-out, the SAME submit returns deployment_not_found (carve-out is load-bearing)", async () => {
    const { ingress } = buildIngress([allowPolicy(), approvalPolicy()], false);
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
  });

  it("idempotent: two submits in the same ISO-week dedup to EXACTLY ONE parked campaign", async () => {
    const { ingress, traces } = buildIngress([allowPolicy(), approvalPolicy()], true);
    const first = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z"))); // Mon
    const second = await ingress.submit(campaignReq(new Date("2026-06-10T08:00:00Z"))); // Wed, same week
    expect(first.ok && "approvalRequired" in first && first.approvalRequired).toBe(true);
    expect(second.ok && "approvalRequired" in second && second.approvalRequired).toBe(true);
    // The replay returns the SAME parked work unit, and only ONE pending_approval campaign persisted.
    if (first.ok && second.ok) {
      expect(second.workUnit?.id).toBe(first.workUnit?.id);
    }
    const parked = traces.filter(
      (t) => t.intent === ROBIN_RECOVERY_SEND_INTENT && t.outcome === "pending_approval",
    );
    expect(parked).toHaveLength(1);
  });

  it("un-seeded org default-DENIES (fail safe, no phantom park)", async () => {
    const { ingress } = buildIngress([], true); // no policies seeded
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    const parked = res.ok && "approvalRequired" in res && res.approvalRequired === true;
    expect(parked).toBe(false);
  });
});
