import { describe, it, expect } from "vitest";
import {
  FollowUpReasonSchema,
  FollowUpDelaySchema,
  ProactiveSkipReasonSchema,
  FOLLOW_UP_DELAY_MS,
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
