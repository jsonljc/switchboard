/**
 * LIVE-PATH proof for the Ledger weekly-report PRODUCER. Drives the real submit MECHANISM the cron
 * fires: buildDeliverWeeklyReportSubmitRequest -> REAL PlatformIngress.submit -> REAL GovernanceGate
 * with the seeded {id:"system"} principal -> REAL OperatorMutationMode handler, resolved through the
 * REAL prod carve-out resolver (resolveAuthoritativeDeployment + buildPlatformDirectIntentPredicate).
 *
 * The shipped unit test (services/cron/ledger-weekly-report.test.ts) passes a synthetic stubbed
 * submit fn, so the prod-inert "deployment_not_found" masking class (the
 * feedback_workflow_intent_deployment_not_found lesson) is UNTESTED there. This proof closes that gap
 * by driving the real resolver + gate + execution.
 *
 * Proves (load-bearing, do not weaken):
 *   1. WITH the carve-out (the REAL predicate over the registry), the throwing resolver (prod has no
 *      "ledger" deployment) still resolves platform-direct, so the submit reaches execution and
 *      returns ok with result.outcome "completed": system_auto_approved auto-approves and the
 *      operator_mutation handler EXECUTES (no deployment_not_found, no park). The actor is the seeded
 *      {id:"system",type:"system"};
 *   2. WITHOUT the carve-out, the SAME submit returns deployment_not_found (the carve-out is the
 *      load-bearing masking class the api harness's null resolver would otherwise hide);
 *   3. two submits with the same ISO-week idempotency key dedup to EXACTLY ONE executed work unit.
 * No Postgres (CI has none for apps/api).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  OperatorMutationMode,
  type GovernanceGateDeps,
  type IntentRegistration,
  type OperatorMutationHandler,
  type DeploymentResolver,
  type Trigger,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
  type WorkTraceClaimResult,
  type WorkTraceUpdateResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec } from "@switchboard/schemas";
import {
  buildPlatformDirectIntentPredicate,
  resolveAuthoritativeDeployment,
} from "../bootstrap/platform-deployment-resolver.js";
import { DELIVER_WEEKLY_REPORT_INTENT } from "../bootstrap/operator-intents/shared.js";
import { buildDeliverWeeklyReportHandler } from "../bootstrap/operator-intents/deliver-weekly-report.js";
import { buildDeliverWeeklyReportSubmitRequest } from "../services/workflows/ledger-weekly-report-request.js";

const ORG = "org-acme";
// The cron keys by ISO week; the same week => the same key => the ingress claim-first guard dedups.
const IDEMPOTENCY_KEY = "ledger-weekly-report:org-acme:2026-W25";

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

// No allow policy is seeded: ledger.deliver_weekly_report is system_auto_approved + non-financial, so
// the gate short-circuits to execute BEFORE loading any approval policy. Wiring the seeded system spec
// keeps the gate deps faithful to production even though the short-circuit returns before they run.
function buildGate(): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [],
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

// Faithful idempotency-aware in-memory trace store. The operator_mutation path is claim-first
// (claimIdempotency persists a `running` WorkTrace with the idempotencyKey BEFORE dispatch, then
// finalizeTrace updates it to its terminal outcome), so claim() must actually STORE the trace and
// dedup on (organizationId, idempotencyKey): that unique is the concurrency lock, and it is what lets
// a same-week re-submit replay the cached completed trace instead of executing the handler twice.
function inMemoryTraceStore(): { store: WorkTraceStore; traces: WorkTrace[] } {
  const traces: WorkTrace[] = [];
  const store = {
    persist: async (t: WorkTrace): Promise<void> => {
      traces.push(t);
    },
    claim: async (t: WorkTrace): Promise<WorkTraceClaimResult> => {
      const clash = traces.find(
        (existing) =>
          existing.organizationId === t.organizationId &&
          existing.idempotencyKey != null &&
          existing.idempotencyKey === t.idempotencyKey,
      );
      if (clash) return { claimed: false };
      traces.push(t);
      return { claimed: true };
    },
    getByWorkUnitId: async (id: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.workUnitId === id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx < 0) {
        return { ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: "not found" };
      }
      traces[idx] = { ...traces[idx]!, ...fields };
      return { ok: true, trace: traces[idx]! };
    },
    getByIdempotencyKey: async (org: string, key: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.organizationId === org && t.idempotencyKey === key);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
  return { store, traces };
}

// Mirrors the production registerOperatorIntent (bootstrap/operator-intents.ts): operator_mutation,
// system_auto_approved, idempotent, with allowedTriggers ["schedule","api"]: the one operator intent
// driven by a cron (trigger "schedule"). Registering it any other way would not exercise the real path.
function ledgerRegistration(): IntentRegistration {
  const allowedTriggers: Trigger[] = ["schedule", "api"];
  return {
    intent: DELIVER_WEEKLY_REPORT_INTENT,
    defaultMode: "operator_mutation",
    allowedModes: ["operator_mutation"],
    executor: { mode: "operator_mutation" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: true,
    allowedTriggers,
    timeoutMs: 30_000,
    retryable: false,
  };
}

// The production resolver THROWS for slug "ledger" (no seeded deployment). The carve-out predicate
// toggles whether resolveAuthoritativeDeployment short-circuits to platform-direct.
function throwingResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error("No active deployment found for org=org-acme slug=ledger");
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as DeploymentResolver;
}

// The REAL operator-mutation handler driven by a fake writer that reports a successful delivery, so
// the gate -> auto-approve -> dispatch -> handler -> completed seam is exercised end to end and the
// execution is observable. The auto-approve + resolution path is REAL; only the email send is faked.
// deliveredCount() exposes how many times the handler ran without leaking the closing counter.
function buildHarness(carveOut: boolean): {
  ingress: PlatformIngress;
  traces: WorkTrace[];
  deliveredCount: () => number;
} {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(ledgerRegistration());

  let deliveries = 0;
  const handler: OperatorMutationHandler = buildDeliverWeeklyReportHandler({
    deliverReport: async () => {
      deliveries += 1;
      return { status: "delivered", recipientCount: 1 };
    },
  });
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new OperatorMutationMode({
      handlers: new Map<string, OperatorMutationHandler>([[DELIVER_WEEKLY_REPORT_INTENT, handler]]),
    }),
  );

  const { store, traces } = inMemoryTraceStore();
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(),
    deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
      isPlatformDirectIntent: carveOut
        ? buildPlatformDirectIntentPredicate(intentRegistry)
        : () => false,
    }),
    traceStore: store,
  });
  return { ingress, traces, deliveredCount: () => deliveries };
}

function reportReq() {
  return buildDeliverWeeklyReportSubmitRequest({
    organizationId: ORG,
    idempotencyKey: IDEMPOTENCY_KEY,
  });
}

describe("ledger weekly-report producer (live path through real ingress + carve-out resolver)", () => {
  it("EXECUTES via the carve-out resolver (system_auto_approved -> completed, no deployment_not_found, no park)", async () => {
    const { ingress, deliveredCount } = buildHarness(true);
    const res = await ingress.submit(reportReq());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // system_auto_approved short-circuits the gate to execute; it does NOT park like the workflow path.
    expect("approvalRequired" in res && res.approvalRequired === true).toBe(false);
    expect(res.result.outcome).toBe("completed");
    // The cron uses the seeded system principal verbatim (a bespoke id has no IdentitySpec, hard-denies).
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });
    // The REAL operator-mutation handler ran exactly once.
    expect(deliveredCount()).toBe(1);
  });

  it("WITHOUT the carve-out, the SAME submit returns deployment_not_found (carve-out is load-bearing)", async () => {
    const { ingress, deliveredCount } = buildHarness(false);
    const res = await ingress.submit(reportReq());

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
    // Prod-inert without the carve-out: the handler never runs.
    expect(deliveredCount()).toBe(0);
  });

  it("idempotent: two submits in the same ISO-week dedup to EXACTLY ONE executed work unit", async () => {
    const { ingress, traces, deliveredCount } = buildHarness(true);
    const first = await ingress.submit(reportReq());
    const second = await ingress.submit(reportReq());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.result.outcome).toBe("completed");
    expect(second.result.outcome).toBe("completed");
    // The replay returns the SAME work unit (idempotency-key cache hit, never a second dispatch).
    expect(second.workUnit?.id).toBe(first.workUnit?.id);
    // The handler executed exactly once across both submits.
    expect(deliveredCount()).toBe(1);
    // Exactly one terminal completed trace persisted for the intent.
    const completed = traces.filter(
      (t) => t.intent === DELIVER_WEEKLY_REPORT_INTENT && t.outcome === "completed",
    );
    expect(completed).toHaveLength(1);
  });
});
