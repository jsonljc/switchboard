import { describe, expect, it } from "vitest";
import {
  ConversationLifecycleStateSchema,
  ConversationLifecycleTriggerSchema,
  ConversationLifecycleActorSchema,
  LifecycleQualificationStatusSchema,
  LifecycleBookingStatusSchema,
  LifecycleDropoffReasonSchema,
  LIFECYCLE_STATE_PRECEDENCE,
  compareLifecyclePrecedence,
} from "../conversation-lifecycle.js";

describe("ConversationLifecycleStateSchema", () => {
  it("accepts the six primary states", () => {
    for (const s of ["active", "qualified", "stalled", "booked", "disqualified", "escalated"]) {
      expect(ConversationLifecycleStateSchema.parse(s)).toBe(s);
    }
  });

  it("rejects re_engaged and qualified_not_booked (must be transition / derived)", () => {
    expect(() => ConversationLifecycleStateSchema.parse("re_engaged")).toThrow();
    expect(() => ConversationLifecycleStateSchema.parse("qualified_not_booked")).toThrow();
  });
});

describe("ConversationLifecycleTriggerSchema", () => {
  it("accepts every documented trigger", () => {
    for (const t of [
      "qualification_checklist_met",
      "qualification_checklist_failed",
      "timer_24h_no_inbound",
      "inbound_after_stalled",
      "inbound_after_re_engagement_template",
      "booking_event_received",
      "governance_verdict_escalate",
      "operator_takeover",
      "operator_confirmed_disqualification",
      "operator_dismissed_disqualification",
      "system_proposed_disqualification",
    ]) {
      expect(ConversationLifecycleTriggerSchema.parse(t)).toBe(t);
    }
  });
});

describe("ConversationLifecycleActorSchema", () => {
  it("enumerates the four actors", () => {
    for (const a of ["system", "alex", "operator", "integration"]) {
      expect(ConversationLifecycleActorSchema.parse(a)).toBe(a);
    }
  });
});

describe("LifecycleQualificationStatusSchema", () => {
  it("includes proposed_disqualified", () => {
    expect(LifecycleQualificationStatusSchema.parse("proposed_disqualified")).toBe(
      "proposed_disqualified",
    );
  });
});

describe("LifecycleBookingStatusSchema", () => {
  it("is binary", () => {
    expect(LifecycleBookingStatusSchema.parse("booked")).toBe("booked");
    expect(LifecycleBookingStatusSchema.parse("not_booked")).toBe("not_booked");
    expect(() => LifecycleBookingStatusSchema.parse("pending")).toThrow();
  });
});

describe("LifecycleDropoffReasonSchema", () => {
  it("accepts null and the documented reasons", () => {
    expect(LifecycleDropoffReasonSchema.parse(null)).toBeNull();
    for (const r of [
      "no_reply",
      "explicit_decline",
      "price_objection",
      "out_of_area",
      "wrong_treatment",
      "operator_marked_not_ready",
    ]) {
      expect(LifecycleDropoffReasonSchema.parse(r)).toBe(r);
    }
  });
});

describe("LIFECYCLE_STATE_PRECEDENCE", () => {
  it("orders booked highest and active lowest", () => {
    expect(LIFECYCLE_STATE_PRECEDENCE.indexOf("booked")).toBe(0);
    expect(LIFECYCLE_STATE_PRECEDENCE.at(-1)).toBe("active");
  });

  it("places disqualified above escalated above stalled above qualified above active", () => {
    const idx = (s: string) => LIFECYCLE_STATE_PRECEDENCE.indexOf(s as never);
    expect(idx("disqualified")).toBeLessThan(idx("escalated"));
    expect(idx("escalated")).toBeLessThan(idx("stalled"));
    expect(idx("stalled")).toBeLessThan(idx("qualified"));
    expect(idx("qualified")).toBeLessThan(idx("active"));
  });
});

describe("compareLifecyclePrecedence", () => {
  it("returns negative when first arg is higher precedence", () => {
    expect(compareLifecyclePrecedence("booked", "stalled")).toBeLessThan(0);
  });

  it("returns positive when first arg is lower precedence", () => {
    expect(compareLifecyclePrecedence("active", "qualified")).toBeGreaterThan(0);
  });

  it("returns zero for the same state", () => {
    expect(compareLifecyclePrecedence("stalled", "stalled")).toBe(0);
  });
});
