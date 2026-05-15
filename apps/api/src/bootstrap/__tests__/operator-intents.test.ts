import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import type { ConsentService, OpportunityStore } from "@switchboard/core";
import {
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "@switchboard/core";
import { OpportunityNotFoundError, type OpportunityBoardRow } from "@switchboard/core/lifecycle";
import {
  buildClearConsentHandler,
  buildGrantConsentHandler,
  buildRevokeConsentHandler,
  buildTransitionOpportunityStageHandler,
  OPERATOR_INTENT_ERROR_CODES,
} from "../operator-intents.js";

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

  it("maps service-runtime guards (notes/system:) → outcome=failed with CONSENT_OPERATION_FAILED", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi
        .fn()
        .mockRejectedValue(new Error("clearConsent rejects system: actors; require a real userId")),
    });
    const handler = buildClearConsentHandler(service);

    const result = await handler.execute(
      makeConsentWorkUnit("operator.clear_consent", { ...clearParams, actor: "system:bot" }),
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONSENT_OPERATION_FAILED);
  });

  it("re-throws non-typed errors (not notes/system: guard messages)", async () => {
    const service = makeConsentServiceStub({
      clearConsent: vi.fn().mockRejectedValue(new Error("postgres connection lost")),
    });
    const handler = buildClearConsentHandler(service);

    await expect(
      handler.execute(makeConsentWorkUnit("operator.clear_consent", clearParams)),
    ).rejects.toThrow("postgres connection lost");
  });
});
