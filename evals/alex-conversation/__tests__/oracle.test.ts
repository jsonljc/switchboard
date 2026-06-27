import { describe, it, expect } from "vitest";
import { ConversationOracleSchema, evaluateOracle } from "../oracle.js";

/** Helper: build a tool-call list from bare tool ids. */
function calls(...ids: string[]): Array<{ toolId: string }> {
  return ids.map((toolId) => ({ toolId }));
}

describe("ConversationOracleSchema (well-formedness)", () => {
  it("accepts an empty oracle", () => {
    expect(ConversationOracleSchema.safeParse({}).success).toBe(true);
  });

  it("accepts well-formed tool/escalation/booking constraints", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectedTools: ["crm-query"],
      forbiddenTools: ["calendar-book"],
      expectsEscalation: false,
      expectsBooking: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a tool id outside the allowed set", () => {
    const parsed = ConversationOracleSchema.safeParse({ expectedTools: ["send-email"] });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const parsed = ConversationOracleSchema.safeParse({ expectedToolz: ["crm-query"] });
    expect(parsed.success).toBe(false);
  });

  it("rejects expectedTools ∩ forbiddenTools overlap", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectedTools: ["crm-query"],
      forbiddenTools: ["crm-query"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects expectsEscalation:true with escalate forbidden", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectsEscalation: true,
      forbiddenTools: ["escalate"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects expectsEscalation:false with escalate expected", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectsEscalation: false,
      expectedTools: ["escalate"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects expectsBooking:true with calendar-book forbidden", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectsBooking: true,
      forbiddenTools: ["calendar-book"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects expectsBooking:false with calendar-book expected", () => {
    const parsed = ConversationOracleSchema.safeParse({
      expectsBooking: false,
      expectedTools: ["calendar-book"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("evaluateOracle", () => {
  it("passes with an empty oracle regardless of tool calls", () => {
    const result = evaluateOracle(calls("crm-query", "calendar-book", "escalate"), {});
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a missing expected tool", () => {
    const result = evaluateOracle(calls("crm-query"), { expectedTools: ["calendar-book"] });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("missing-expected-tool:calendar-book");
  });

  it("passes when all expected tools are present (dupes count once)", () => {
    const result = evaluateOracle(calls("crm-query", "crm-query"), {
      expectedTools: ["crm-query"],
    });
    expect(result.pass).toBe(true);
  });

  it("flags a forbidden tool that was called", () => {
    const result = evaluateOracle(calls("crm-query", "calendar-book"), {
      forbiddenTools: ["calendar-book"],
    });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("forbidden-tool-called:calendar-book");
  });

  it("flags expected-escalation-missing", () => {
    const result = evaluateOracle(calls("crm-query"), { expectsEscalation: true });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("expected-escalation-missing");
  });

  it("passes when an expected escalation occurred", () => {
    const result = evaluateOracle(calls("crm-query", "escalate"), { expectsEscalation: true });
    expect(result.pass).toBe(true);
  });

  it("flags unexpected-escalation", () => {
    const result = evaluateOracle(calls("escalate"), { expectsEscalation: false });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("unexpected-escalation");
  });

  it("flags expected-booking-missing", () => {
    const result = evaluateOracle(calls("crm-query"), { expectsBooking: true });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("expected-booking-missing");
  });

  it("flags unexpected-booking", () => {
    const result = evaluateOracle(calls("calendar-book"), { expectsBooking: false });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("unexpected-booking");
  });

  it("accumulates multiple violations", () => {
    const result = evaluateOracle(calls("calendar-book"), {
      expectedTools: ["crm-query"],
      forbiddenTools: ["calendar-book"],
      expectsEscalation: true,
    });
    expect(result.pass).toBe(false);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("missing-expected-tool:crm-query");
    expect(codes).toContain("forbidden-tool-called:calendar-book");
    expect(codes).toContain("expected-escalation-missing");
    expect(result.violations).toHaveLength(3);
  });
});

describe("bookingWithinWindow (slot-vs-window)", () => {
  const WINDOW = {
    earliestIso: "2026-06-01T00:00:00.000Z",
    latestIso: "2026-06-01T12:00:00.000Z",
  };

  it("accepts a well-formed booking window", () => {
    expect(
      ConversationOracleSchema.safeParse({ expectsBooking: true, bookingWithinWindow: WINDOW })
        .success,
    ).toBe(true);
  });

  it("rejects a window whose earliest is after its latest", () => {
    expect(
      ConversationOracleSchema.safeParse({
        bookingWithinWindow: {
          earliestIso: "2026-06-01T12:00:00.000Z",
          latestIso: "2026-06-01T00:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("passes when the booking.create slotStart is within the window", () => {
    const result = evaluateOracle(
      [
        {
          toolId: "calendar-book",
          operation: "booking.create",
          params: { slotStart: "2026-06-01T06:00:00.000Z" },
        },
      ],
      { bookingWithinWindow: WINDOW },
    );
    expect(result.pass).toBe(true);
  });

  it("flags a booking.create slotStart OUTSIDE the stated window", () => {
    const result = evaluateOracle(
      [
        {
          toolId: "calendar-book",
          operation: "booking.create",
          params: { slotStart: "2026-06-02T06:00:00.000Z" },
        },
      ],
      { bookingWithinWindow: WINDOW },
    );
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("booking-outside-window");
  });

  it("flags an unverifiable booking when slotStart is missing", () => {
    const result = evaluateOracle(
      [{ toolId: "calendar-book", operation: "booking.create", params: {} }],
      { bookingWithinWindow: WINDOW },
    );
    expect(result.violations.map((v) => v.code)).toContain("booking-window-unverifiable");
  });

  it("does not raise a window violation when no booking.create occurred", () => {
    const result = evaluateOracle([{ toolId: "crm-query", operation: "contact.get" }], {
      bookingWithinWindow: WINDOW,
    });
    expect(result.violations.map((v) => v.code)).not.toContain("booking-outside-window");
  });
});

describe("depositAfterBooking (deposit-only-after-a-booking ordering)", () => {
  /** Build an ordered (toolId, operation) trajectory. */
  function ops(...pairs: Array<[string, string]>): Array<{ toolId: string; operation: string }> {
    return pairs.map(([toolId, operation]) => ({ toolId, operation }));
  }

  it("accepts a well-formed depositAfterBooking oracle", () => {
    expect(
      ConversationOracleSchema.safeParse({
        expectsBooking: true,
        expectedTools: ["deposit-link"],
        depositAfterBooking: true,
      }).success,
    ).toBe(true);
  });

  it("rejects depositAfterBooking:true with deposit-link forbidden (contradiction)", () => {
    expect(
      ConversationOracleSchema.safeParse({
        depositAfterBooking: true,
        forbiddenTools: ["deposit-link"],
      }).success,
    ).toBe(false);
  });

  it("flags a deposit issued before any booking.create", () => {
    const result = evaluateOracle(
      ops(["deposit-link", "deposit.issue"], ["calendar-book", "booking.create"]),
      { depositAfterBooking: true },
    );
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("deposit-before-booking");
  });

  it("flags a deposit issued with no booking.create at all", () => {
    const result = evaluateOracle(ops(["deposit-link", "deposit.issue"]), {
      depositAfterBooking: true,
    });
    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("deposit-before-booking");
  });

  it("passes when the deposit.issue comes after a booking.create", () => {
    const result = evaluateOracle(
      ops(["calendar-book", "booking.create"], ["deposit-link", "deposit.issue"]),
      { depositAfterBooking: true },
    );
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not flag when no deposit was issued", () => {
    const result = evaluateOracle(ops(["calendar-book", "booking.create"]), {
      depositAfterBooking: true,
    });
    expect(result.pass).toBe(true);
  });
});
