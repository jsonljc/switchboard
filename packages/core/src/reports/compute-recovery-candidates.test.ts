import { describe, it, expect, vi } from "vitest";
import { computeRecoveryCandidates } from "./compute-recovery-candidates.js";
import type { RollupContext } from "./types.js";

const from = new Date("2026-06-01T00:00:00Z");
const to = new Date("2026-06-15T00:00:00Z");

const ctx: RollupContext = {
  orgId: "o1",
  current: { start: from, end: to, window: "THIS MONTH" },
  prior: { start: new Date("2026-05-01T00:00:00Z"), end: from, window: null },
  computedAt: new Date("2026-06-14"),
};

describe("computeRecoveryCandidates", () => {
  it("noShows passthrough: returns the count from countNoShowsInWindow", async () => {
    const bookings = {
      countNoShowsInWindow: vi.fn(async (_input: { orgId: string; from: Date; to: Date }) => 7),
    };
    const result = await computeRecoveryCandidates(ctx, bookings as never);
    expect(result).toEqual({ noShows: 7 });
    expect(bookings.countNoShowsInWindow).toHaveBeenCalledWith({ orgId: "o1", from, to });
  });

  it("zero no-shows returns { noShows: 0 }", async () => {
    const bookings = {
      countNoShowsInWindow: vi.fn(async (_input: { orgId: string; from: Date; to: Date }) => 0),
    };
    const result = await computeRecoveryCandidates(ctx, bookings as never);
    expect(result).toEqual({ noShows: 0 });
  });
});
