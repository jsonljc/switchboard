// ── Pause lifecycle world: the REAL respond + dispatch stack over a pause-only
// harness ──
//
// Mirrors recommendation-handoff-lifecycle-world.ts for the Phase-C pause
// intent: REAL PlatformIngress + REAL GovernanceGate with the SEEDED pause
// policies (from the SAME db builders production seeds) + REAL
// ApprovalLifecycleService + REAL PlatformLifecycle dispatching the REAL pause
// executor over a FAKE Meta client (records calls; one-shot failure switch).
// The only synthetic pieces are the Meta client and the in-memory stores.

import {
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  PlatformLifecycle,
  type IntentRegistration,
  type WorkflowHandler,
} from "@switchboard/core/platform";
import type { WorkTrace, WorkTraceStore, WorkTraceReadResult } from "@switchboard/core/platform";
import {
  ApprovalLifecycleService,
  InMemoryLifecycleStore,
  createInMemoryStorage,
  AuditLedger,
  InMemoryLedgerStorage,
} from "@switchboard/core";
import type { Policy } from "@switchboard/schemas";
import {
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
} from "@switchboard/db";
import { buildGate, deploymentResolver, ORG } from "./recommendation-handoff-harness.js";
import { buildRileyPauseExecutionWorkflow } from "../services/workflows/riley-pause-execution-workflow.js";
import { RILEY_PAUSE_INTENT } from "../services/workflows/riley-pause-submit-request.js";
import { buildMarkRecommendationActed } from "../bootstrap/riley-pause-executor.js";

export function pauseAllowPolicy(): Policy {
  return {
    ...buildRileyPauseAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

export function pauseApprovalPolicy(): Policy {
  return {
    ...buildRileyPauseApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

export function pauseRegistration(): IntentRegistration {
  return {
    intent: RILEY_PAUSE_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: RILEY_PAUSE_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

/** In-memory trace store WITH a working org-scoped idempotency lookup (the
 * handoff harness stubs it to null; the pause loop pins duplicate-submit
 * behavior, so the lookup must be real). */
function pauseTraceStore(): WorkTraceStore {
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
    getByIdempotencyKey: async (
      organizationId: string,
      key: string,
    ): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find(
        (t) => t.organizationId === organizationId && t.idempotencyKey === key,
      );
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
}

export function buildPauseLifecycleWorld(opts?: {
  /** Optional billing-entitlement stub; absent = entitlement gate not wired
   * (PR-1 loop tests). The cron loop's named-skip leg wires an unentitled one.
   * Typed via the ingress config's own field (the resolver interface is not on
   * core's public barrel). */
  entitlementResolver?: ConstructorParameters<typeof PlatformIngress>[0]["entitlementResolver"];
}) {
  const metaCalls: Array<{ campaignId: string; status: string }> = [];
  const sabotage = { failNext: false };

  // Slice 4f: an in-memory recommendation row honoring markActedByExecution's
  // conditional contract, driven through the REAL bootstrap closure so the
  // loop also pins the sentinel + arg mapping. Tests may mutate `status` to
  // simulate an operator preempt.
  const recommendationRow = {
    id: "rec_1",
    organizationId: ORG,
    intent: "recommendation.pause",
    status: "pending" as string,
    resolvedAt: null as Date | null,
    resolvedBy: null as string | null,
    executedWorkUnitId: null as string | null,
  };
  const markRecommendationActed = buildMarkRecommendationActed({
    markActedByExecution: async (args) => {
      if (
        args.id !== recommendationRow.id ||
        args.organizationId !== recommendationRow.organizationId ||
        // Mirror the real method's recommendation-intent guard (fidelity:
        // the db method refuses workflow rows sharing the table).
        !recommendationRow.intent.startsWith("recommendation.")
      ) {
        return { transitioned: false, reason: "not_found" };
      }
      if (recommendationRow.status !== "pending") {
        return { transitioned: false, reason: "not_pending" };
      }
      recommendationRow.status = "acted";
      recommendationRow.resolvedAt = args.executedAt;
      recommendationRow.resolvedBy = args.resolvedBy;
      recommendationRow.executedWorkUnitId = args.executableWorkUnitId;
      return { transitioned: true };
    },
  });

  const pauseHandler: WorkflowHandler = buildRileyPauseExecutionWorkflow({
    getDeploymentCredentials: async (organizationId, _deploymentId) =>
      organizationId === ORG
        ? { kind: "ok" as const, credentials: { accessToken: "tok", accountId: "act_1" } }
        : { kind: "org_mismatch" as const },
    createAdsClient: () => ({
      getCampaignStatus: async () => ({ status: "ACTIVE", effectiveStatus: "ACTIVE" }),
      updateCampaignStatus: async (campaignId: string, status: "PAUSED") => {
        if (sabotage.failNext) {
          sabotage.failNext = false;
          throw new Error("Meta API error (500): transient");
        }
        metaCalls.push({ campaignId, status });
      },
    }),
    markRecommendationActed,
  });

  const intentRegistry = new IntentRegistry();
  intentRegistry.register(pauseRegistration());

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([[RILEY_PAUSE_INTENT, pauseHandler]]),
      services: {
        // The pause executor never submits child work; a reach into this stub is a bug.
        submitChildWork: async () => {
          throw new Error("pause executor must not submit child work");
        },
      },
    }),
  );

  const traceStore = pauseTraceStore();
  const lifecycleStore = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store: lifecycleStore });
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate([pauseAllowPolicy(), pauseApprovalPolicy()]),
    deploymentResolver: deploymentResolver(),
    traceStore,
    lifecycleService,
    ...(opts?.entitlementResolver ? { entitlementResolver: opts.entitlementResolver } : {}),
  });

  const storage = createInMemoryStorage();
  const ledger = new AuditLedger(new InMemoryLedgerStorage());
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry,
    traceStore,
    ledger,
    trustAdapter: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
  });
  const deps = {
    lifecycleService,
    workTraceStore: traceStore,
    platformLifecycle,
    auditLedger: ledger,
    logger: { info: () => {}, error: () => {} },
  };

  return {
    harness: {
      ingress,
      traceStore,
      metaCalls,
      recommendationRow,
      breakMetaOnce: () => {
        sabotage.failNext = true;
      },
    },
    lifecycleService,
    lifecycleStore,
    platformLifecycle,
    ledger,
    deps,
  };
}
