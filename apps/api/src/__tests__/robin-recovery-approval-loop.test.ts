/**
 * The S4 keystone: a parked Robin recovery campaign is approved through the REAL
 * ApprovalLifecycleService + respondToParkedLifecycle + the REAL PlatformLifecycle.executeApproved
 * (executeAfterApproval -> the REAL ExecutionModeRegistry -> the REAL consent-gated recovery
 * executor over a fake WhatsApp sender). This is the feedback_lifecycle_respond_fork_no_dispatch
 * lesson applied to Robin: because the campaign PARKS, the send happens ONLY on the post-approval
 * dispatch leg, so the executor's own unit tests (which call handler.execute directly) do not prove
 * it actually runs in production. This proves, end to end:
 *
 *   submit parks (NEVER auto-sends; nothing reaches a patient pre-approval)
 *   -> a REAL approve dispatches the executor -> the frozen cohort is sent, per recipient
 *   -> trace completed with the campaign's {sent, skipped, failed, total} outputs
 *   -> a REAL reject sends nothing and fails the trace
 *
 * Mirrors riley-pause-approval-loop.test.ts. The only synthetic pieces are the WhatsApp sender, the
 * dedup store, the send-context resolver, and the in-memory platform stores.
 */
import { describe, it, expect } from "vitest";
import {
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  PlatformLifecycle,
  type IntentRegistration,
  type WorkflowHandler,
} from "@switchboard/core/platform";
import {
  respondToParkedLifecycle,
  ApprovalLifecycleService,
  InMemoryLifecycleStore,
  createInMemoryStorage,
  AuditLedger,
  InMemoryLedgerStorage,
  type RobinRecoverySendStore,
} from "@switchboard/core";
import type { Policy } from "@switchboard/schemas";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
} from "@switchboard/db";
import {
  buildGate,
  inMemoryTraceStore,
  deploymentResolver,
  ORG,
} from "./recommendation-handoff-harness.js";
import { buildRobinRecoverySendExecutor } from "../bootstrap/robin-recovery-executor.js";
import {
  buildRecoveryCampaignSubmitRequest,
  ROBIN_RECOVERY_SEND_INTENT,
} from "../services/workflows/robin-recovery-request.js";

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

/** In-memory dedup store recording claimed rows + their terminal status. */
function inMemoryRecoverySendStore(): {
  store: RobinRecoverySendStore;
  rows: Array<{ id: string; dedupeKey: string; status: string; messageId?: string | null }>;
} {
  const rows: Array<{ id: string; dedupeKey: string; status: string; messageId?: string | null }> =
    [];
  let n = 0;
  const store: RobinRecoverySendStore = {
    create: async (input) => {
      if (rows.some((r) => r.dedupeKey === input.dedupeKey)) {
        throw Object.assign(new Error("dup"), { code: "P2002" });
      }
      const id = `rs_${++n}`;
      rows.push({ id, dedupeKey: input.dedupeKey, status: "pending" });
      return { id };
    },
    markSent: async (id, messageId) => {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.status = "sent";
        r.messageId = messageId;
      }
    },
    markSkipped: async (id, reason) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = `skipped:${reason}`;
    },
    markFailed: async (id, error) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = `failed:${error}`;
    },
  };
  return { store, rows };
}

function approvedTemplate() {
  return {
    name: "re_engagement_offer_sg_v1",
    metaTemplateName: "alex_re_engagement_offer_sg_v1",
    intentClass: "re-engagement-offer" as const,
    jurisdiction: "SG" as const,
    templateCategory: "marketing" as const,
    approvalStatus: "approved" as const,
    body: "Hi {{lead_name}} ... {{business_name}}.",
    variables: [
      { name: "lead_name", description: "first" },
      { name: "business_name", description: "clinic" },
    ],
  };
}

function buildWorld() {
  const sendCalls: Array<{ to: string; metaTemplateName: string }> = [];
  const { store, rows } = inMemoryRecoverySendStore();

  const executor = buildRobinRecoverySendExecutor({
    store,
    getSendContext: async (_orgId, contactId) => ({
      consentGrantedAt: "2026-05-01T00:00:00.000Z",
      consentRevokedAt: null,
      pdpaJurisdiction: "SG",
      messagingOptIn: true,
      lastWhatsAppInboundAt: new Date("2026-06-05T12:00:00Z"),
      jurisdiction: "SG",
      leadName: "Mei",
      businessName: "Glow Clinic",
      phone: `+65${contactId}`,
    }),
    sendTemplate: async (args) => {
      sendCalls.push({ to: args.to, metaTemplateName: args.metaTemplateName });
      return { ok: true, messageId: `wamid.${sendCalls.length}` };
    },
    selectTemplateFn: () => approvedTemplate(),
    resolveSendToken: () => "tok",
    resolvePhoneNumberId: () => "pn_1",
  });

  const intentRegistry = new IntentRegistry();
  intentRegistry.register(robinRegistration());

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([[executor.intent, executor.handler]]),
      services: {
        submitChildWork: async () => {
          throw new Error("recovery executor must not submit child work");
        },
      },
    }),
  );

  const traceStore = inMemoryTraceStore();
  const lifecycleService = new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() });
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate([allowPolicy(), approvalPolicy()]),
    deploymentResolver: deploymentResolver(),
    traceStore,
    lifecycleService,
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

  return { ingress, traceStore, lifecycleService, deps, sendCalls, rows };
}

const candidates = [
  {
    bookingId: "bk_1",
    contactId: "ct_1",
    service: "Botox",
    startsAt: new Date("2026-06-03T09:00:00Z"),
    attendeeName: "Mei",
  },
  {
    bookingId: "bk_2",
    contactId: "ct_2",
    service: "Filler",
    startsAt: new Date("2026-06-04T10:00:00Z"),
    attendeeName: "Sam",
  },
];

function campaignReq() {
  return buildRecoveryCampaignSubmitRequest({
    organizationId: ORG,
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-15T00:00:00Z"),
    asOf: new Date("2026-06-08T08:00:00Z"),
    candidates,
  })!;
}

async function park(w: ReturnType<typeof buildWorld>) {
  const res = await w.ingress.submit(campaignReq());
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("submit failed");
  expect("approvalRequired" in res && res.approvalRequired).toBe(true);
  expect(res.result.outcome).toBe("pending_approval");
  const lifecycleId = (res as { lifecycleId?: string }).lifecycleId;
  const bindingHash = (res as { bindingHash?: string }).bindingHash;
  if (!lifecycleId || !bindingHash) throw new Error("park did not return lifecycle identifiers");
  return { lifecycleId, bindingHash };
}

describe("robin recovery approve-to-dispatch loop (real respond + dispatch stack)", () => {
  it("NEVER auto-sends: the submit parks and no WhatsApp is sent before a human approves", async () => {
    const w = buildWorld();
    await park(w);
    expect(w.sendCalls).toHaveLength(0);
    expect(w.rows).toHaveLength(0); // no dedup rows claimed pre-approval either
  });

  it("park -> approve -> the executor sends the frozen cohort; trace completed with outputs", async () => {
    const w = buildWorld();
    const { lifecycleId, bindingHash } = await park(w);

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "approve",
      respondedBy: "operator_jane",
      bindingHash,
    });
    expect(result.approvalState.status).toBe("approved");
    expect(result.executionResult?.success).toBe(true);

    // The REAL dispatch leg ran THIS executor over the FROZEN cohort: one send per candidate.
    expect(w.sendCalls).toEqual([
      { to: "+65ct_1", metaTemplateName: "alex_re_engagement_offer_sg_v1" },
      { to: "+65ct_2", metaTemplateName: "alex_re_engagement_offer_sg_v1" },
    ]);
    expect(w.rows.map((r) => r.status)).toEqual(["sent", "sent"]);

    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(lifecycle?.status).toBe("approved");
    const trace = (await w.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.executionOutputs).toMatchObject({ sent: 2, skipped: 0, failed: 0, total: 2 });
  });

  it("a REAL reject sends nothing and fails the trace", async () => {
    const w = buildWorld();
    const { lifecycleId } = await park(w);

    const result = await respondToParkedLifecycle(w.deps, {
      lifecycleId,
      action: "reject",
      respondedBy: "operator_jane",
    });
    expect(result.approvalState.status).toBe("rejected");
    expect(w.sendCalls).toHaveLength(0);
    const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
    expect(lifecycle?.status).toBe("rejected");
    const trace = (await w.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
    expect(trace.outcome).toBe("failed");
  });
});
