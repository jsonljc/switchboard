/**
 * LIVE-PATH regression guard for the A22 entitlement carve-out (#1289).
 *
 * Drives the REAL wiring the A22 unit tests mock away: REAL `bootstrapOperatorIntents`
 * (so `payment.record_verified` is registered `revenueRecording: true` +
 * `system_auto_approved` + non-spend) -> a REAL `PlatformIngress` whose entitlement
 * gate is fed a NON-ENTITLED resolver -> the REAL `GovernanceGate` (the
 * `system_auto_approved` short-circuit + the `isFinancialIntent` check that must NOT
 * re-gate an inbound `amount`) -> the REAL `resolveAuthoritativeDeployment` +
 * `buildPlatformDirectIntentPredicate` carve-out -> the REAL record-verified handler.
 *
 * Proves the production claim of A22: a NON-ENTITLED org's PSP-verified, settled
 * deposit is RECORDED (receipt + revenue + purchased outbox) instead of returning
 * `entitlement_required` and 500-storming the Stripe webhook. The carve-out is
 * load-bearing: removing `revenueRecording`, marking the intent `spendBearing`,
 * teaching `isFinancialIntent` to count `amount`, or dropping the platform-direct
 * predicate would each flip `result.ok` to false and fail the first test below.
 *
 * No Postgres (CI has none for apps/api): the stores/PSP are injected fakes;
 * everything between (bootstrap, ingress, entitlement gate, governance gate,
 * deployment carve-out resolver, handler) is production code. Helpers mirror
 * memory-write-live-path.test.ts + record-verified-payment.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  type GovernanceGateDeps,
  type DeploymentResolver,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity, type RevenueStore } from "@switchboard/core";
import type { BillingEntitlementResolver } from "@switchboard/core/billing";
import type { IdentitySpec, LifecycleRevenueEvent, VerifiedPayment } from "@switchboard/schemas";
import { bootstrapOperatorIntents, MEMORY_WRITE_INTENT } from "../bootstrap/operator-intents.js";
import {
  RECORD_VERIFIED_PAYMENT_INTENT,
  type ReceiptWriter,
} from "../bootstrap/operator-intents/record-verified-payment.js";
import type { OutboxWriter, RunInTransaction } from "../bootstrap/operator-intents/revenue.js";
import {
  resolveAuthoritativeDeployment,
  buildPlatformDirectIntentPredicate,
} from "../bootstrap/platform-deployment-resolver.js";

const ORG = "org-canceled";
const TX = { __tx: true } as const;

// A `service` actor (the in-process payments webhook submits exactly this); the seeded
// "system" principal keeps the governance deps production-faithful.
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

function inMemoryTraceStore(): WorkTraceStore {
  const traces: WorkTrace[] = [];
  return {
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
    getByIdempotencyKey: async () => null,
  } as unknown as WorkTraceStore;
}

// Production resolves an operator-intent slug to no deployment (THROWS); the platform-direct
// carve-out predicate is what lets resolveAuthoritativeDeployment short-circuit instead of
// surfacing the throw as deployment_not_found.
function throwingResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error(`No active deployment found for org=${ORG}`);
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as DeploymentResolver;
}

// payment.record_verified is system_auto_approved + non-financial (inbound `amount` is NOT an
// outbound-spend key), so the gate short-circuits to execute BEFORE any approval policy; the
// empty loadPolicies proves the short-circuit (a default-deny would otherwise fire).
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

function makeEvent(): LifecycleRevenueEvent {
  return {
    id: "rev_1",
    organizationId: ORG,
    contactId: "c1",
    opportunityId: "opp-1",
    amount: 5000,
    currency: "SGD",
    type: "deposit",
    status: "confirmed",
    recordedBy: "stripe",
    externalReference: "pi_abc",
    bookingId: "book-1",
    verified: true,
    sourceCampaignId: null,
    sourceAdId: null,
    recordedAt: new Date(0),
    createdAt: new Date(0),
  };
}

function charge(): VerifiedPayment {
  return {
    provider: "stripe",
    externalReference: "pi_abc",
    amountCents: 5000,
    currency: "sgd",
    status: "paid",
    bookingId: "book-1",
  };
}

// Always-blocked entitlement: the org's subscription is canceled. In prod this returns
// entitled for an active org; here it stays blocked so the carve-out is the ONLY reason a
// revenue-recording intent gets through.
const nonEntitled: BillingEntitlementResolver = {
  resolve: async () => ({ entitled: false, reason: "blocked", blockedStatus: "canceled" }),
};

function makeRevenueStore(): { record: ReturnType<typeof vi.fn> } & RevenueStore {
  return {
    record: vi.fn(async () => makeEvent()),
    findByOpportunity: vi.fn(async () => []),
    findByContact: vi.fn(async () => []),
    sumByOrg: vi.fn(async () => ({ totalAmount: 0, count: 0 })),
    sumByCampaign: vi.fn(async () => []),
  };
}

const runInTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) as RunInTransaction;

function buildHarness() {
  const intentRegistry = new IntentRegistry();
  const modeRegistry = new ExecutionModeRegistry();
  const receiptWriter: ReceiptWriter = { write: vi.fn(async () => {}) };
  const revenueStore = makeRevenueStore();
  const outboxWriter: OutboxWriter = { write: vi.fn(async () => {}) };
  // memory.write is the control intent: a non-revenue operator intent, registered the same
  // system_auto_approved way, so a block on it proves the entitlement gate is genuinely live.
  const memoryWriteStore = { create: vi.fn(async () => ({ id: "mem_1" })) };
  bootstrapOperatorIntents({
    intentRegistry,
    modeRegistry,
    receiptWriter,
    revenueStore,
    outboxWriter,
    runInTransaction: runInTx,
    paymentVerifier: vi.fn(async () => charge()),
    memoryWriteStore,
  });
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(),
    deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
      isPlatformDirectIntent: buildPlatformDirectIntentPredicate(intentRegistry),
    }),
    traceStore: inMemoryTraceStore(),
    entitlementResolver: nonEntitled,
  });
  return { ingress, receiptWriter, revenueStore, outboxWriter, intentRegistry };
}

function submitPayment(ingress: PlatformIngress) {
  return ingress.submit({
    organizationId: ORG,
    actor: { id: "system", type: "service" },
    intent: RECORD_VERIFIED_PAYMENT_INTENT,
    parameters: {
      contactId: "c1",
      opportunityId: "opp-1",
      bookingId: "book-1",
      amountCents: 5000,
      currency: "SGD",
      externalReference: "pi_abc",
      provider: "stripe",
    },
    trigger: "api",
    surface: { surface: "api" },
    idempotencyKey: "psp-evt_test",
  });
}

describe("payment.record_verified entitlement carve-out (live: real bootstrap + ingress + entitlement + gate + carve-out)", () => {
  it("records a NON-ENTITLED org's PSP-verified deposit end-to-end instead of returning entitlement_required", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ingress, receiptWriter, revenueStore, outboxWriter } = buildHarness();

    const res = await submitPayment(ingress);

    // The carve-out cleared the entitlement gate AND the real governance short-circuit AND the
    // platform-direct deployment resolution, reaching execution.
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBeFalsy();
    expect(res.result.outcome).toBe("completed");
    // The receipt + revenue event + purchased outbox were ALL written for the non-entitled org
    // (the proof chain is not lost).
    expect(receiptWriter.write).toHaveBeenCalledTimes(1);
    expect(revenueStore.record).toHaveBeenCalledTimes(1);
    expect(outboxWriter.write).toHaveBeenCalledTimes(1);
    // ...and the reconciliation signal fired.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[entitlement.carveout]"))).toBe(
      true,
    );
    warnSpy.mockRestore();
  });

  it("CONTROL: a non-revenue operator intent for the SAME non-entitled org IS blocked entitlement_required (gate is genuinely live)", async () => {
    const { ingress } = buildHarness();

    const res = await ingress.submit({
      organizationId: ORG,
      actor: { id: "system", type: "system" },
      intent: MEMORY_WRITE_INTENT,
      parameters: {
        deploymentId: "dep_1",
        category: "fact",
        content: "Closed on Sundays",
        source: "conversation-compounding",
      },
      trigger: "internal",
      surface: { surface: "api" },
      idempotencyKey: "mw:org-canceled:dep_1:fact:1",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("entitlement_required");
  });

  it("registers payment.record_verified revenueRecording + system_auto_approved + NOT spendBearing (the invariants the carve-out + auto-approve rely on)", () => {
    const { intentRegistry } = buildHarness();
    const reg = intentRegistry.lookup(RECORD_VERIFIED_PAYMENT_INTENT);
    expect(reg?.revenueRecording).toBe(true);
    expect(reg?.approvalMode).toBe("system_auto_approved");
    expect(reg?.spendBearing ?? false).toBe(false);
  });
});
