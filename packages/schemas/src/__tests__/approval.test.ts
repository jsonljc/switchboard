import { describe, expect, it } from "vitest";
import {
  ApprovalStateSchema,
  type ApprovalState,
  ApprovalRecordSchema,
  type ApprovalRecord,
} from "../approval.js";

describe("ApprovalStateSchema", () => {
  it("parses a minimal valid state", () => {
    const valid: ApprovalState = {
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    };
    const result = ApprovalStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("parses a state with quorum entries", () => {
    const withQuorum: ApprovalState = {
      status: "approved",
      respondedBy: "user_a",
      respondedAt: new Date(),
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600_000),
      version: 2,
      quorum: {
        required: 2,
        approvalHashes: [
          { approverId: "user_a", hash: "abc", approvedAt: new Date() },
          { approverId: "user_b", hash: "def", approvedAt: new Date() },
        ],
      },
    };
    expect(ApprovalStateSchema.safeParse(withQuorum).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "not-a-status",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ISO-string dates (domain schema is strict, no coercion)", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: "2026-12-31T23:59:59.000Z",
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("ApprovalRecordSchema", () => {
  const validRequest = {
    id: "appr_1",
    actionId: "act_1",
    envelopeId: "env_1",
    conversationId: null,
    summary: "Test approval",
    riskCategory: "medium",
    bindingHash: "abc123hash",
    evidenceBundle: {
      decisionTrace: {},
      contextSnapshot: {},
      identitySnapshot: {},
    },
    suggestedButtons: [],
    approvers: ["user_a"],
    fallbackApprover: null,
    status: "pending" as const,
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(Date.now() + 3600_000),
    expiredBehavior: "deny" as const,
    createdAt: new Date(),
    quorum: null,
  };

  it("parses a minimal valid record", () => {
    const record: ApprovalRecord = {
      request: validRequest,
      state: {
        status: "pending",
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    };
    const result = ApprovalRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts a non-null organizationId", () => {
    const record: ApprovalRecord = {
      request: validRequest,
      state: {
        status: "approved",
        respondedBy: "user_a",
        respondedAt: new Date(),
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: "org_a",
    };
    expect(ApprovalRecordSchema.safeParse(record).success).toBe(true);
  });

  it("rejects when state.status is missing", () => {
    const result = ApprovalRecordSchema.safeParse({
      request: validRequest,
      state: {
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    });
    expect(result.success).toBe(false);
  });

  it("keeps legacy request-date coercion but requires strict Date in state (mixed-boundary lock)", () => {
    // ApprovalRequestSchema in chat.ts uses z.coerce.date() for legacy reasons
    // (PR-2 leaves it untouched). ApprovalStateSchema (Task 1) is strict —
    // z.date() with no coercion. The composed ApprovalRecord therefore has
    // intentionally asymmetric date handling: request.expiresAt accepts an
    // ISO string and coerces; state.expiresAt rejects strings outright. This
    // test locks the asymmetry so a future reviewer doesn't "tidy up" one
    // side without the other.
    //
    // The asymmetry is documented in the "Schema boundary rule" /
    // "Reconciliation with existing z.coerce.date() usages" section of the
    // PR-2 plan; a blanket sweep of legacy coerce-date usages is deferred
    // to PR-3 / a follow-up.
    const requestWithStringDate = {
      ...validRequest,
      // String-typed dates on the request side — should still parse via coercion.
      expiresAt: "2026-12-31T23:59:59.000Z" as unknown as Date,
      createdAt: "2026-05-22T10:00:00.000Z" as unknown as Date,
    };
    const acceptsStringOnRequest = ApprovalRecordSchema.safeParse({
      request: requestWithStringDate,
      state: {
        status: "pending",
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    });
    expect(acceptsStringOnRequest.success).toBe(true);

    const rejectsStringOnState = ApprovalRecordSchema.safeParse({
      request: validRequest,
      state: {
        status: "pending",
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: "2026-12-31T23:59:59.000Z", // string — must be rejected
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    });
    expect(rejectsStringOnState.success).toBe(false);
  });
});
