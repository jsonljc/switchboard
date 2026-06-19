import { describe, it, expect } from "vitest";
import {
  buildRecoveryCampaignSubmitRequest,
  ROBIN_RECOVERY_SEND_INTENT,
} from "../robin-recovery-request.js";

// Date-based candidate (the read/filter output shape), NOT the ISO payload shape.
const candidate = {
  bookingId: "bk_1",
  contactId: "ct_1",
  service: "Botox",
  startsAt: new Date("2026-06-03T09:00:00.000Z"),
  attendeeName: "Jamie",
};

describe("buildRecoveryCampaignSubmitRequest", () => {
  it("returns null for an empty cohort (an empty campaign must never park)", () => {
    expect(
      buildRecoveryCampaignSubmitRequest({
        organizationId: "org_1",
        windowFrom: new Date("2026-06-01T00:00:00Z"),
        windowTo: new Date("2026-06-15T00:00:00Z"),
        asOf: new Date("2026-06-15T08:00:00Z"),
        candidates: [],
      }),
    ).toBeNull();
  });

  it("builds a system-principal, schedule-trigger, parked-intent request with no targetHint", () => {
    const req = buildRecoveryCampaignSubmitRequest({
      organizationId: "org_1",
      windowFrom: new Date("2026-06-01T00:00:00Z"),
      windowTo: new Date("2026-06-15T00:00:00Z"),
      asOf: new Date("2026-06-15T08:00:00Z"), // Mon; the idempotency cadence anchor
      candidates: [candidate],
    });
    expect(req).not.toBeNull();
    expect(req!.intent).toBe(ROBIN_RECOVERY_SEND_INTENT);
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.trigger).toBe("schedule");
    expect(req!.targetHint).toBeUndefined(); // robin has no deployment; resolves to platform-direct
    const params = req!.parameters as {
      recipientCount: number;
      candidates: Array<{ startsAt: string }>;
    };
    expect(params.recipientCount).toBe(1);
    expect(params.candidates[0]!.startsAt).toBe("2026-06-03T09:00:00.000Z"); // serialized to ISO
    // Keyed by the ISO-week of asOf (not the scan window), so re-runs within a week dedup.
    expect(req!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-15:recovery");
  });

  it("buckets the idempotency key by ISO-week+org (same week same key; next week new key)", () => {
    const base = {
      organizationId: "org_1",
      windowFrom: new Date("2026-06-01T00:00:00Z"),
      windowTo: new Date("2026-06-30T00:00:00Z"),
      candidates: [candidate],
    };
    const mon = buildRecoveryCampaignSubmitRequest({
      ...base,
      asOf: new Date("2026-06-15T00:00:00Z"),
    });
    const sun = buildRecoveryCampaignSubmitRequest({
      ...base,
      asOf: new Date("2026-06-21T23:59:00Z"),
    });
    const nextMon = buildRecoveryCampaignSubmitRequest({
      ...base,
      asOf: new Date("2026-06-22T00:00:00Z"),
    });
    expect(mon!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-15:recovery");
    expect(sun!.idempotencyKey).toBe(mon!.idempotencyKey); // Mon..Sun fall in the same bucket
    expect(nextMon!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-22:recovery"); // next week differs
  });
});
