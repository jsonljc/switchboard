import { describe, it, expect } from "vitest";
import { ReconcileBookingParametersSchema } from "./receipted-booking-reconcile.js";

describe("ReconcileBookingParametersSchema", () => {
  it("parses an override_attribution variant", () => {
    const parsed = ReconcileBookingParametersSchema.parse({
      action: "override_attribution",
      bookingId: "bk_1",
      confidence: "high",
      reason: "owner knows the source",
    });
    expect(parsed).toEqual({
      action: "override_attribution",
      bookingId: "bk_1",
      confidence: "high",
      reason: "owner knows the source",
    });
  });

  it("parses a flag_duplicate variant", () => {
    const parsed = ReconcileBookingParametersSchema.parse({
      action: "flag_duplicate",
      bookingId: "bk_1",
      detail: "same phone as bk_9",
    });
    expect(parsed).toEqual({
      action: "flag_duplicate",
      bookingId: "bk_1",
      detail: "same phone as bk_9",
    });
  });

  it("parses a resolve_exception variant", () => {
    const parsed = ReconcileBookingParametersSchema.parse({
      action: "resolve_exception",
      bookingId: "bk_1",
      code: "duplicate_contact_risk",
    });
    expect(parsed).toEqual({
      action: "resolve_exception",
      bookingId: "bk_1",
      code: "duplicate_contact_risk",
    });
  });

  it("accepts the full ExceptionCode enum on resolve_exception (forward-compat)", () => {
    const parsed = ReconcileBookingParametersSchema.parse({
      action: "resolve_exception",
      bookingId: "bk_1",
      code: "missing_source",
    });
    expect(parsed.action === "resolve_exception" && parsed.code).toBe("missing_source");
  });

  it("rejects an unknown action", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "delete_booking",
      bookingId: "bk_1",
    });
    expect(res.success).toBe(false);
  });

  it("rejects an empty bookingId", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "override_attribution",
      bookingId: "",
      confidence: "high",
      reason: "x",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a missing reason on override_attribution", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "override_attribution",
      bookingId: "bk_1",
      confidence: "high",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a bad confidence enum on override_attribution", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "override_attribution",
      bookingId: "bk_1",
      confidence: "bogus",
      reason: "x",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a missing detail on flag_duplicate", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "flag_duplicate",
      bookingId: "bk_1",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a bad code enum on resolve_exception", () => {
    const res = ReconcileBookingParametersSchema.safeParse({
      action: "resolve_exception",
      bookingId: "bk_1",
      code: "not_a_code",
    });
    expect(res.success).toBe(false);
  });
});
