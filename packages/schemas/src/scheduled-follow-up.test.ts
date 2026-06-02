import { describe, it, expect } from "vitest";
import {
  FollowUpReasonSchema,
  FollowUpDelaySchema,
  ProactiveSkipReasonSchema,
  FOLLOW_UP_DELAY_MS,
} from "./scheduled-follow-up.js";
import {
  CADENCE_TOUCH1_DELAY_MS,
  NEXT_TOUCH_GAP_DAYS,
  MAX_CADENCE_TOUCHES,
  MIN_NEXT_TOUCH_GAP_MS,
  ACTIVATION_RETRY_INTERVAL_MS,
  ACTIVATION_MAX_OVERDUE_MS,
  buildFollowUpDedupeKey,
  classifyCadenceSkip,
} from "./scheduled-follow-up.js";

describe("scheduled-follow-up schemas", () => {
  it("accepts the documented follow-up reasons", () => {
    expect(FollowUpReasonSchema.parse("hesitation")).toBe("hesitation");
    expect(() => FollowUpReasonSchema.parse("nope")).toThrow();
  });

  it("maps each delay enum to a positive millisecond offset", () => {
    for (const delay of FollowUpDelaySchema.options) {
      expect(FOLLOW_UP_DELAY_MS[delay]).toBeGreaterThan(0);
    }
    expect(FOLLOW_UP_DELAY_MS.in_1_day).toBe(24 * 60 * 60 * 1000);
    expect(FOLLOW_UP_DELAY_MS.in_1_week).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("enumerates every skip reason the gate can return", () => {
    expect(ProactiveSkipReasonSchema.parse("template_not_approved")).toBe("template_not_approved");
  });
});

describe("cadence primitives", () => {
  it("exposes the +2/+5/+12 cadence constants", () => {
    expect(CADENCE_TOUCH1_DELAY_MS).toBe(2 * 24 * 60 * 60 * 1000);
    expect(NEXT_TOUCH_GAP_DAYS).toEqual({ 1: 3, 2: 7 });
    expect(MAX_CADENCE_TOUCHES).toBe(3);
    expect(MIN_NEXT_TOUCH_GAP_MS).toBe(48 * 60 * 60 * 1000);
    expect(ACTIVATION_RETRY_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(ACTIVATION_MAX_OVERDUE_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("buildFollowUpDedupeKey is day-bucketed and touch-suffixed", () => {
    const dueAt = new Date("2026-06-04T09:30:00.000Z");
    expect(buildFollowUpDedupeKey("org_1", "c_1", dueAt, 1)).toBe(
      "followup:org_1:c_1:2026-06-04:t1",
    );
    expect(buildFollowUpDedupeKey("org_1", "c_1", dueAt, 2)).toBe(
      "followup:org_1:c_1:2026-06-04:t2",
    );
  });

  it("classifyCadenceSkip: only template_not_approved/no_template are re-evaluable", () => {
    expect(classifyCadenceSkip("template_not_approved")).toBe("activation");
    expect(classifyCadenceSkip("no_template")).toBe("activation");
    for (const durable of [
      "consent_revoked",
      "consent_pending",
      "no_optin",
      "marketing_blocked",
      "unsupported_channel",
      "unknown",
    ]) {
      expect(classifyCadenceSkip(durable)).toBe("durable");
    }
  });
});
