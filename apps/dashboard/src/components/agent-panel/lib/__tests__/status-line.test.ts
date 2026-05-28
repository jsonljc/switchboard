import { describe, expect, it } from "vitest";
import { composeStatusLine } from "@/components/agent-panel/lib/status-line";

const NOW = new Date("2026-05-25T15:42:00Z").getTime();
const state = (over: Partial<{ activityStatus: string; lastActionAt: string | null }> = {}) => ({
  activityStatus: "working",
  lastActionAt: "2026-05-25T15:30:00Z",
  ...over,
});

describe("composeStatusLine", () => {
  it("fresh oldest item → 'Nothing old is waiting' + presence secondary", () => {
    const r = composeStatusLine({
      oldestOpenItemAgeHours: 2,
      fallingBehindHours: 12,
      state: state(),
      nowMs: NOW,
    });
    expect(r.health).toBe("Nothing old is waiting");
    expect(r.presence).toBe("Last action 12m ago");
  });
  it("aging past threshold → 'Oldest lead has waited Nh'", () => {
    const r = composeStatusLine({
      oldestOpenItemAgeHours: 14,
      fallingBehindHours: 12,
      state: state(),
      nowMs: NOW,
    });
    expect(r.health).toBe("Oldest lead has waited 14h");
  });
  it("null signal → presence only, never a fabricated health read", () => {
    const r = composeStatusLine({
      oldestOpenItemAgeHours: null,
      fallingBehindHours: 12,
      state: state(),
      nowMs: NOW,
    });
    expect(r.health).toBeNull();
    expect(r.presence).toBe("Last action 12m ago");
  });
  it("no recorded action → stale presence copy", () => {
    const r = composeStatusLine({
      oldestOpenItemAgeHours: null,
      fallingBehindHours: 12,
      state: state({ lastActionAt: null }),
      nowMs: NOW,
    });
    expect(r.presence).toBe("No recorded action in 24h");
  });
});
