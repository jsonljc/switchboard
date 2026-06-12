import { describe, it, expect } from "vitest";
import { projectBookingWins, type BookingWinSignalRow } from "../booking-wins.js";

function row(over: Partial<BookingWinSignalRow> = {}): BookingWinSignalRow {
  return {
    traceId: "trace_1",
    deploymentId: "dep_alex",
    skillSlug: "alex",
    bookingId: "bk_1",
    contactId: "c_1",
    service: "botox",
    bookingStatus: "confirmed",
    bookedAt: new Date("2026-06-12T03:00:00Z"),
    value: 45000,
    sourceCampaignId: "camp_9",
    sourceAdId: "ad_3",
    occurredAt: new Date("2026-06-12T03:00:00Z"),
    ...over,
  };
}
const NOW = new Date("2026-06-12T04:00:00Z");
const TZ = "Asia/Singapore";

describe("projectBookingWins", () => {
  it("maps a ledger row to a win carrying trace, service and raw revenue cents", () => {
    const vm = projectBookingWins([row()], { now: NOW, timezone: TZ });
    expect(vm.wins).toHaveLength(1);
    const w = vm.wins[0]!;
    expect(w.traceId).toBe("trace_1");
    expect(w.service).toBe("botox");
    expect(w.valueCents).toBe(45000);
    expect(w.revenuePending).toBe(false);
    expect(w.bookingStatus).toBe("confirmed");
    expect(w.sourceCampaignId).toBe("camp_9");
    expect(typeof w.timeFolio).toBe("string");
    expect(w.timeFolio.length).toBeGreaterThan(0);
    expect(vm.freshness.dataSource).toBe("live");
  });

  it("flags revenue pending and uses bookedAt when the conversion has not settled", () => {
    const vm = projectBookingWins(
      [row({ value: null, sourceCampaignId: null, occurredAt: null })],
      {
        now: NOW,
        timezone: TZ,
      },
    );
    const w = vm.wins[0]!;
    expect(w.valueCents).toBeNull();
    expect(w.revenuePending).toBe(true);
    expect(w.occurredAtIso).toBe(new Date("2026-06-12T03:00:00Z").toISOString());
  });

  it("caps to 5 wins and sets hasMore when more rows exist", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ traceId: `t_${i}`, bookingId: `b_${i}` }),
    );
    const vm = projectBookingWins(rows, { now: NOW, timezone: TZ });
    expect(vm.wins).toHaveLength(5);
    expect(vm.hasMore).toBe(true);
  });

  it("returns an empty, non-error vm for no rows (honest empty)", () => {
    const vm = projectBookingWins([], { now: NOW, timezone: TZ });
    expect(vm.wins).toEqual([]);
    expect(vm.hasMore).toBe(false);
  });
});
