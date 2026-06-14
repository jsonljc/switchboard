import { describe, it, expect, vi } from "vitest";
import { computeReceiptedBookings } from "./compute-receipted-bookings.js";

const ctx = {
  orgId: "o1",
  current: { start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  computedAt: new Date("2026-06-14"),
} as never;

describe("computeReceiptedBookings", () => {
  it("returns the org-scoped, in-window calendar-receipt count", async () => {
    const receipts = {
      countReceiptedBookingsInWindow: vi.fn(async () => 41),
    };
    expect(await computeReceiptedBookings(ctx, receipts as never)).toEqual({ count: 41 });
    expect(receipts.countReceiptedBookingsInWindow).toHaveBeenCalledWith({
      orgId: "o1",
      from: new Date("2026-06-08"),
      to: new Date("2026-06-15"),
    });
  });

  it("count===0 => { count: 0 } (the tile renders the em-dash)", async () => {
    const receipts = {
      countReceiptedBookingsInWindow: vi.fn(async () => 0),
    };
    expect(await computeReceiptedBookings(ctx, receipts as never)).toEqual({ count: 0 });
  });
});
