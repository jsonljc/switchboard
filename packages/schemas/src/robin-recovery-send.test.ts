import { describe, it, expect } from "vitest";
import { buildRecoveryDedupeKey, RobinRecoverySendStatusSchema } from "./robin-recovery-send.js";

describe("buildRecoveryDedupeKey", () => {
  it("is deterministic and per-(kind, org, booking)", () => {
    expect(buildRecoveryDedupeKey("org_1", "bk_1", "no_show")).toBe("recovery:no_show:org_1:bk_1");
  });
  it("distinguishes orgs and bookings", () => {
    expect(buildRecoveryDedupeKey("org_1", "bk_1", "no_show")).not.toBe(
      buildRecoveryDedupeKey("org_2", "bk_1", "no_show"),
    );
    expect(buildRecoveryDedupeKey("org_1", "bk_1", "no_show")).not.toBe(
      buildRecoveryDedupeKey("org_1", "bk_2", "no_show"),
    );
  });
});

describe("RobinRecoverySendStatusSchema", () => {
  it("accepts the four states", () => {
    for (const s of ["pending", "sent", "skipped", "failed"]) {
      expect(RobinRecoverySendStatusSchema.parse(s)).toBe(s);
    }
  });
  it("rejects unknown", () => {
    expect(() => RobinRecoverySendStatusSchema.parse("queued")).toThrow();
  });
});
