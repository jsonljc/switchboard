import { describe, it, expect, vi } from "vitest";
import { computeHeldRate } from "./compute-held-rate.js";

const ctx = {
  orgId: "o1",
  current: { start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  computedAt: new Date("2026-06-14"),
} as never;

describe("computeHeldRate", () => {
  it("rate = attended/matured", async () => {
    const bookings = { countMaturedAttendance: vi.fn(async () => ({ matured: 45, attended: 38 })) };
    expect(await computeHeldRate(ctx, bookings as never)).toEqual({
      attended: 38,
      matured: 45,
      rate: 38 / 45,
    });
  });

  it("matured===0 => rate null (no NaN)", async () => {
    const bookings = { countMaturedAttendance: vi.fn(async () => ({ matured: 0, attended: 0 })) };
    expect(await computeHeldRate(ctx, bookings as never)).toEqual({
      attended: 0,
      matured: 0,
      rate: null,
    });
  });
});
