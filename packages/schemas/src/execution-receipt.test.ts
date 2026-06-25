import { describe, it, expect } from "vitest";
import { ExecutionReceiptSchema } from "./execution-receipt.js";

const VALID_RESET = {
  kind: "campaign_budget_reset" as const,
  organizationId: "org-1",
  deploymentId: "dep-riley",
  adAccountId: "act_123",
  campaignId: "camp_1",
  workTraceId: "wt_reset_1",
  executionWorkUnitId: "wu_reset_1",
  rollbackOfWorkUnitId: "wu_forward_1",
  breachMetric: "account_booked_conversions_drop_share" as const,
  breachReason: "exceeded" as const,
  targetCents: 5000,
  observedLiveCents: 6000,
  appliedCents: 5000,
  deltaCentsSigned: -1000,
  executedAt: "2026-06-25T03:30:00.000Z",
};

const VALID = {
  kind: "campaign_budget_reallocation" as const,
  organizationId: "org-1",
  deploymentId: "dep-riley",
  adAccountId: "act_123",
  campaignId: "camp_1",
  workTraceId: "wt_1",
  executionWorkUnitId: "wu_1",
  approvedLifecycleId: "lc_1",
  bindingHash: "sha256:abc",
  requestedFromCents: 5000,
  requestedToCents: 6000,
  observedPriorCents: 5000,
  appliedCents: 6000,
  deltaCentsSigned: 1000,
  executedAt: "2026-06-07T03:30:00.000Z",
};

describe("ExecutionReceiptSchema (Spec-1B success artifact; money fields are safe positive cents)", () => {
  it("accepts a well-formed reallocation receipt", () => {
    expect(ExecutionReceiptSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects the wrong kind literal (this schema is reallocation-only)", () => {
    expect(ExecutionReceiptSchema.safeParse({ ...VALID, kind: "campaign_pause" }).success).toBe(
      false,
    );
  });

  for (const field of [
    "requestedFromCents",
    "requestedToCents",
    "observedPriorCents",
    "appliedCents",
  ] as const) {
    it(`rejects a negative ${field} (money is positive cents)`, () => {
      expect(ExecutionReceiptSchema.safeParse({ ...VALID, [field]: -1 }).success).toBe(false);
    });
    it(`rejects a zero ${field} (a budget is strictly positive)`, () => {
      expect(ExecutionReceiptSchema.safeParse({ ...VALID, [field]: 0 }).success).toBe(false);
    });
    it(`rejects a fractional ${field} (cents are integers)`, () => {
      expect(ExecutionReceiptSchema.safeParse({ ...VALID, [field]: 50.5 }).success).toBe(false);
    });
    it(`rejects an unsafe-integer ${field}`, () => {
      expect(ExecutionReceiptSchema.safeParse({ ...VALID, [field]: 2 ** 60 }).success).toBe(false);
    });
  }

  it("allows a NEGATIVE deltaCentsSigned (a budget DECREASE is a legitimate signed delta)", () => {
    const decrease = {
      ...VALID,
      requestedFromCents: 8000,
      requestedToCents: 5000,
      observedPriorCents: 8000,
      appliedCents: 5000,
      deltaCentsSigned: -3000,
    };
    expect(ExecutionReceiptSchema.safeParse(decrease).success).toBe(true);
  });

  it("rejects a fractional or unsafe deltaCentsSigned (still an integer cents value)", () => {
    expect(ExecutionReceiptSchema.safeParse({ ...VALID, deltaCentsSigned: 10.5 }).success).toBe(
      false,
    );
    expect(ExecutionReceiptSchema.safeParse({ ...VALID, deltaCentsSigned: 2 ** 60 }).success).toBe(
      false,
    );
  });

  it("rejects a non-datetime executedAt", () => {
    expect(ExecutionReceiptSchema.safeParse({ ...VALID, executedAt: "yesterday" }).success).toBe(
      false,
    );
  });

  it("rejects a missing required id field", () => {
    const { campaignId: _drop, ...without } = VALID;
    expect(ExecutionReceiptSchema.safeParse(without).success).toBe(false);
  });
});

describe("ExecutionReceiptSchema campaign_budget_reset variant (automated rollback artifact)", () => {
  it("accepts a well-formed reset receipt", () => {
    expect(ExecutionReceiptSchema.safeParse(VALID_RESET).success).toBe(true);
  });

  it("still accepts a reallocation receipt (the union did not regress)", () => {
    expect(ExecutionReceiptSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a reset receipt missing rollbackOfWorkUnitId (the reversal must name its forward move)", () => {
    const { rollbackOfWorkUnitId: _drop, ...without } = VALID_RESET;
    expect(ExecutionReceiptSchema.safeParse(without).success).toBe(false);
  });

  it("rejects an unknown breachMetric (the union is closed)", () => {
    expect(
      ExecutionReceiptSchema.safeParse({ ...VALID_RESET, breachMetric: "made_up" }).success,
    ).toBe(false);
  });

  it("rejects an unknown breachReason", () => {
    expect(
      ExecutionReceiptSchema.safeParse({ ...VALID_RESET, breachReason: "vibes" }).success,
    ).toBe(false);
  });

  it("allows a NEGATIVE deltaCentsSigned (a reset undoes an increase, so it decreases)", () => {
    expect(ExecutionReceiptSchema.safeParse(VALID_RESET).success).toBe(true);
  });

  for (const field of ["targetCents", "observedLiveCents", "appliedCents"] as const) {
    it(`rejects a non-positive ${field} (a budget is strictly positive cents)`, () => {
      expect(ExecutionReceiptSchema.safeParse({ ...VALID_RESET, [field]: 0 }).success).toBe(false);
      expect(ExecutionReceiptSchema.safeParse({ ...VALID_RESET, [field]: -1 }).success).toBe(false);
    });
  }

  it("a reset receipt must NOT need a reallocation-only field (approvedLifecycleId is absent)", () => {
    expect("approvedLifecycleId" in VALID_RESET).toBe(false);
    expect(ExecutionReceiptSchema.safeParse(VALID_RESET).success).toBe(true);
  });
});
