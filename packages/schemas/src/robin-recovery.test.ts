import { describe, it, expect } from "vitest";
import { RobinRecoveryRetryParamsSchema } from "./robin-recovery.js";

describe("RobinRecoveryRetryParamsSchema", () => {
  it("rejects empty rowId and accepts a full payload", () => {
    expect(
      RobinRecoveryRetryParamsSchema.safeParse({
        rowId: "",
        contactId: "c_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 0,
      }).success,
    ).toBe(false);

    expect(
      RobinRecoveryRetryParamsSchema.safeParse({
        rowId: "rs_1",
        contactId: "c_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects empty contactId", () => {
    expect(
      RobinRecoveryRetryParamsSchema.safeParse({
        rowId: "rs_1",
        contactId: "",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects negative attempts", () => {
    expect(
      RobinRecoveryRetryParamsSchema.safeParse({
        rowId: "rs_1",
        contactId: "c_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer attempts", () => {
    expect(
      RobinRecoveryRetryParamsSchema.safeParse({
        rowId: "rs_1",
        contactId: "c_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 1.5,
      }).success,
    ).toBe(false);
  });
});
