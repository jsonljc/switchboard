import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { ExecutionModeRegistry, IntentRegistry } from "@switchboard/core/platform";
import type { ConsentService, OpportunityStore } from "@switchboard/core";
import {
  ConsentJurisdictionMismatch,
  ConsentNotesRequired,
  ConsentRevokedCannotRegrant,
  ConsentSystemActorRejected,
  ContactNotFound,
} from "@switchboard/core";
import { OpportunityNotFoundError, type OpportunityBoardRow } from "@switchboard/core/lifecycle";
import {
  bootstrapOperatorIntents,
  buildClearConsentHandler,
  buildGrantConsentHandler,
  buildRevokeConsentHandler,
  buildTransitionOpportunityStageHandler,
  DELIVER_WEEKLY_REPORT_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
  type WeeklyReportDeliveryWriter,
} from "../operator-intents.js";
import type { DeliveryResult } from "../../services/reports/weekly-report-delivery.js";

function mkBoardRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "booked",
    timeline: null,
    priceReadiness: null,
    objections: [],
    qualificationComplete: true,
    estimatedValue: 1000,
    revenueTotal: 0,
    assignedAgent: null,
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-15T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: "2026-05-15T00:00:00.000Z",
    organizationId: "org_acme",
    actor: { id: "operator_1", type: "user" },
    intent: "operator.transition_opportunity_stage",
    parameters: { id: "opp_1", stage: "booked" },
    deployment: {
      deploymentId: "dep_op",
      skillSlug: "operator",
      trustLevel: "guided",
      trustScore: 100,
    },
    resolvedMode: "operator_mutation",
    traceId: "trace_1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  };
}

function makeStoreStub(overrides: Partial<OpportunityStore> = {}): OpportunityStore {
  return {
    transitionStage: vi.fn(),
    ...overrides,
  } as unknown as OpportunityStore;
}

describe("buildTransitionOpportunityStageHandler", () => {
  it("returns completed with opportunity output on success", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockResolvedValue({
        opportunity: mkBoardRow({ id: "opp_1", stage: "booked" }),
        workTraceId: "wt_1",
      }),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    const result = await handler.execute(makeWorkUnit());

    expect(store.transitionStage).toHaveBeenCalledWith({
      orgId: "org_acme",
      id: "opp_1",
      stage: "booked",
      actor: { id: "operator_1", type: "user" },
    });
    expect(result.outcome).toBe("completed");
    const outputs = result.outputs as { opportunity: { id: string; stage: string } };
    expect(outputs.opportunity.id).toBe("opp_1");
    expect(outputs.opportunity.stage).toBe("booked");
  });

  it("maps OpportunityNotFoundError to outcome=failed with OPPORTUNITY_NOT_FOUND code", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockRejectedValue(new OpportunityNotFoundError("opp_missing")),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    const result = await handler.execute(
      makeWorkUnit({ parameters: { id: "opp_missing", stage: "booked" } }),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND);
  });

  it("re-throws non-OpportunityNotFoundError errors so infra failures surface as 500", async () => {
    const store = makeStoreStub({
      transitionStage: vi.fn().mockRejectedValue(new Error("postgres connection lost")),
    });
    const handler = buildTransitionOpportunityStageHandler(store);

    await expect(handler.execute(makeWorkUnit())).rejects.toThrow("postgres connection lost");
  });

  it("rejects parameters that fail Zod validation (defense in depth)", async () => {
    const store = makeStoreStub();
    const handler = buildTransitionOpportunityStageHandler(store);

    await expect(
      handler.execute(makeWorkUnit({ parameters: { id: "", stage: "booked" } })),
    ).rejects.toThrow();
    expect(store.transitionStage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 1b.4 — admin-consent handler factories
// ---------------------------------------------------------------------------

function makeConsentServiceStub(overrides: Partial<ConsentService> = {}): ConsentService {
  return {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeConsentWorkUnit(
  intent: string,
  parameters: Record<string, unknown>,
  overrides: Partial<WorkUnit> = {},
): WorkUnit {
  return makeWorkUnit({
    intent,
    parameters,
    ...overrides,
  });
}

const grantParams = {
  contactId: "c1",
  jurisdiction: "MY",
  source: "operator_recorded",
  grantedAt: "2026-05-11T10:00:00.000Z",
  notes: "captured offline",
  actor: "operator_42",
};

const revokeParams = {
  contactId: "c1",
  source: "operator_recorded_revocation",
  revokedAt: "2026-05-11T11:00:00.000Z",
  notes: "customer requested",
  actor: "operator_42",
};

const clearParams = {
  contactId: "c1",
  notes: "operator reset",
  actor: "operator_42",
};

describe("buildGrantConsentHandler", () => {
  it("returns completed with contactId output on success", async () => {
    const service = makeConsentServiceStub();
    const handler = buildGrantConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.grant_consent", grantParams),
    );

    expect(service.recordGrant).toHaveBeenCalledWith({
      contactId: "c1",
      jurisdiction: "MY",
      source: "operator_recorded",
      grantedAt: new Date("2026-05-11T10:00:00.000Z"),
      actor: "operator_42",
      notes: "captured offline",
      organizationId: "org_acme",
      deploymentId: "system:admin-endpoint",
    });
    expect(result.outcome).toBe("completed");
    const outputs = result.outputs as { contactId: string };
    expect(outputs.contactId).toBe("c1");
  });

  it("maps ContactNotFound → outcome=failed with CONSENT_NOT_FOUND code", async () => {
    const service = makeConsentServiceStub({
      recordGrant: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const handler = buildGrantConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.grant_consent", grantParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND);
    expect((result.outputs as { contactId: string }).contactId).toBe("c1");
  });

  it("maps ConsentJurisdictionMismatch → outcome=failed with CONSENT_INVALID_JURISDICTION + stamped/provided in outputs", async () => {
    const service = makeConsentServiceStub({
      recordGrant: vi
        .fn()
        .mockRejectedValue(
          new ConsentJurisdictionMismatch({ contactId: "c1", stamped: "SG", provided: "MY" }),
        ),
    });
    const handler = buildGrantConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.grant_consent", grantParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_INVALID_JURISDICTION);
    const outputs = result.outputs as { stamped: string; provided: string };
    expect(outputs.stamped).toBe("SG");
    expect(outputs.provided).toBe("MY");
  });

  it("maps ConsentRevokedCannotRegrant → outcome=failed with CONSENT_REVOKED_CANNOT_REGRANT + revokedAt in outputs", async () => {
    const revokedAt = new Date("2026-05-10T00:00:00Z");
    const service = makeConsentServiceStub({
      recordGrant: vi
        .fn()
        .mockRejectedValue(new ConsentRevokedCannotRegrant({ contactId: "c1", revokedAt })),
    });
    const handler = buildGrantConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.grant_consent", grantParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_REVOKED_CANNOT_REGRANT);
    const outputs = result.outputs as { revokedAt: string };
    expect(outputs.revokedAt).toBe(revokedAt.toISOString());
  });

  it("re-throws non-typed errors so infra failures surface as scrubbed 500", async () => {
    const service = makeConsentServiceStub({
      recordGrant: vi.fn().mockRejectedValue(new Error("postgres connection lost")),
    });
    const handler = buildGrantConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.grant_consent", grantParams)),
    ).rejects.toThrow("postgres connection lost");
  });

  it("rejects parameters that fail Zod validation (defense in depth)", async () => {
    const service = makeConsentServiceStub();
    const handler = buildGrantConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.grant_consent", { contactId: "" })),
    ).rejects.toThrow();
    expect(service.recordGrant).not.toHaveBeenCalled();
  });
});

describe("buildRevokeConsentHandler", () => {
  it("returns completed with contactId output on success", async () => {
    const service = makeConsentServiceStub();
    const handler = buildRevokeConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.revoke_consent", revokeParams),
    );

    expect(service.recordRevocation).toHaveBeenCalledWith({
      contactId: "c1",
      source: "operator_recorded_revocation",
      revokedAt: new Date("2026-05-11T11:00:00.000Z"),
      actor: "operator_42",
      notes: "customer requested",
      organizationId: "org_acme",
      deploymentId: "system:admin-endpoint",
    });
    expect(result.outcome).toBe("completed");
    expect((result.outputs as { contactId: string }).contactId).toBe("c1");
  });

  it("maps ContactNotFound → outcome=failed with CONSENT_NOT_FOUND code", async () => {
    const service = makeConsentServiceStub({
      recordRevocation: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const handler = buildRevokeConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.revoke_consent", revokeParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND);
  });

  it("re-throws non-typed errors", async () => {
    const service = makeConsentServiceStub({
      recordRevocation: vi.fn().mockRejectedValue(new Error("downstream timeout")),
    });
    const handler = buildRevokeConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.revoke_consent", revokeParams)),
    ).rejects.toThrow("downstream timeout");
  });
});

describe("buildClearConsentHandler", () => {
  it("returns completed with contactId output on success", async () => {
    const service = makeConsentServiceStub();
    const handler = buildClearConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.clear_consent", clearParams),
    );

    expect(service.clearConsent).toHaveBeenCalledWith({
      contactId: "c1",
      actor: "operator_42",
      notes: "operator reset",
      organizationId: "org_acme",
      deploymentId: "system:admin-endpoint",
    });
    expect(result.outcome).toBe("completed");
    expect((result.outputs as { contactId: string }).contactId).toBe("c1");
  });

  it("maps ContactNotFound → outcome=failed with CONSENT_NOT_FOUND code", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const handler = buildClearConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.clear_consent", clearParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND);
  });

  it("maps ConsentSystemActorRejected → outcome=failed with CONSENT_OPERATION_FAILED", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi
        .fn()
        .mockRejectedValue(new ConsentSystemActorRejected({ actor: "system:bot" })),
    });
    const handler = buildClearConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.clear_consent", { ...clearParams, actor: "system:bot" }),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_OPERATION_FAILED);
  });

  it("maps ConsentNotesRequired → outcome=failed with CONSENT_OPERATION_FAILED", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi.fn().mockRejectedValue(new ConsentNotesRequired()),
    });
    const handler = buildClearConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.clear_consent", clearParams),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_OPERATION_FAILED);
  });

  it("re-throws untyped errors (no substring fallback — only instanceof checks)", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi.fn().mockRejectedValue(new Error("postgres connection lost")),
    });
    const handler = buildClearConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.clear_consent", clearParams)),
    ).rejects.toThrow("postgres connection lost");
  });

  it("re-throws plain Error with 'system:' in message — substring no longer reclassifies", async () => {
    // Regression: legacy substring-match would catch this and return 400.
    // After Phase 1b.4 review-followup, only typed errors are mapped → real
    // failure surfaces as 500 via global error handler.
    const service = makeConsentServiceStub({
      clearConsent: vi
        .fn()
        .mockRejectedValue(new Error("system: bus disconnected during clearConsent")),
    });
    const handler = buildClearConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.clear_consent", clearParams)),
    ).rejects.toThrow("system: bus disconnected");
  });
});

// ---------------------------------------------------------------------------
// ledger.deliver_weekly_report: schedule-trigger governance registration
// ---------------------------------------------------------------------------
// LOAD-BEARING: this is the only operator intent allowed on the "schedule"
// trigger. The shared registerOperatorIntent helper hardcodes ["api"] by
// default, which would make the weekly cron's submit (trigger "schedule") fail
// the trigger_not_allowed gate in PlatformIngress. This test proves the explicit
// ["schedule", "api"] list reaches the IntentRegistry, that "chat" stays denied,
// and that the handler is wired into the mode so a submit would actually execute.
// ---------------------------------------------------------------------------
describe("bootstrapOperatorIntents: ledger.deliver_weekly_report registration", () => {
  function makeWeeklyWriter(): WeeklyReportDeliveryWriter {
    return {
      deliverReport: vi.fn<(input: { orgId: string; actorId: string }) => Promise<DeliveryResult>>(
        () => Promise.resolve({ status: "delivered", recipientCount: 1 }),
      ),
    };
  }

  it("registers the schedule + api triggers (and denies chat) when a writer is provided", () => {
    const intentRegistry = new IntentRegistry();
    const modeRegistry = new ExecutionModeRegistry();

    bootstrapOperatorIntents({
      intentRegistry,
      modeRegistry,
      weeklyReportDeliveryWriter: makeWeeklyWriter(),
    });

    // The schedule leg the shared ["api"]-only default would otherwise block.
    expect(intentRegistry.validateTrigger(DELIVER_WEEKLY_REPORT_INTENT, "schedule")).toBe(true);
    expect(intentRegistry.validateTrigger(DELIVER_WEEKLY_REPORT_INTENT, "api")).toBe(true);
    expect(intentRegistry.validateTrigger(DELIVER_WEEKLY_REPORT_INTENT, "chat")).toBe(false);

    // The registration exists and stays system_auto_approved + non-spend-bearing.
    const registration = intentRegistry.lookup(DELIVER_WEEKLY_REPORT_INTENT);
    expect(registration).toBeDefined();
    expect(registration?.approvalMode).toBe("system_auto_approved");
    expect(registration?.spendBearing ?? false).toBe(false);
    expect(registration?.executor).toEqual({ mode: "operator_mutation" });

    // The handler is wired into the operator-mutation mode (a submit would dispatch it).
    expect(modeRegistry.hasMode("operator_mutation")).toBe(true);
  });

  it("does NOT register the intent when no writer is provided (default-off wiring)", () => {
    const intentRegistry = new IntentRegistry();
    const modeRegistry = new ExecutionModeRegistry();

    bootstrapOperatorIntents({ intentRegistry, modeRegistry });

    expect(intentRegistry.lookup(DELIVER_WEEKLY_REPORT_INTENT)).toBeUndefined();
    expect(intentRegistry.validateTrigger(DELIVER_WEEKLY_REPORT_INTENT, "schedule")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A22 — payment.record_verified must be flagged revenueRecording so the entitlement
// gate in PlatformIngress carves it out: a PSP-verified, already-settled deposit is
// recorded even for a non-entitled org instead of 500-storming the Stripe webhook
// and losing the T1 receipt + revenue event. The flag must be SPECIFIC to the
// inbound-revenue intent, not blanket-set on every operator intent by the shared
// registerOperatorIntent helper.
// ---------------------------------------------------------------------------
describe("bootstrapOperatorIntents: payment.record_verified revenue-recording flag (A22)", () => {
  it("registers payment.record_verified as revenueRecording, and does NOT flag a non-revenue operator intent", () => {
    const intentRegistry = new IntentRegistry();
    const modeRegistry = new ExecutionModeRegistry();

    bootstrapOperatorIntents({
      intentRegistry,
      modeRegistry,
      // Control intent (operator.transition_opportunity_stage) — gated by opportunityStore.
      opportunityStore: makeStoreStub(),
      // The five deps that gate payment.record_verified registration.
      receiptWriter: { write: vi.fn() } as never,
      revenueStore: { record: vi.fn() } as never,
      outboxWriter: { write: vi.fn() } as never,
      runInTransaction: vi.fn() as never,
      paymentVerifier: vi.fn() as never,
    });

    const payment = intentRegistry.lookup("payment.record_verified");
    expect(payment).toBeDefined();
    expect(payment?.revenueRecording).toBe(true);

    // Control: a sibling operator intent that records nothing inbound is NOT carved out.
    const transition = intentRegistry.lookup("operator.transition_opportunity_stage");
    expect(transition).toBeDefined();
    expect(transition?.revenueRecording ?? false).toBe(false);
  });
});
