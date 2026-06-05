import { describe, it, expect } from "vitest";
import { renderPastPerformanceBlock, renderTasteBlock } from "./prompt-blocks.js";

const HISTORY = {
  kind: "performance_history" as const,
  version: 1 as const,
  generatedAt: "2026-06-04T12:00:00.000Z",
  topPerformers: [
    {
      jobId: "job-1",
      descriptor: "polished:question",
      trueRoas: 5,
      spend: 50,
      bookedValueCents: 25000,
      window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z" },
    },
    {
      jobId: "job-2",
      descriptor: "polished:bold_statement",
      trueRoas: null,
      spend: 12.5,
      bookedValueCents: 0,
      window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z" },
    },
  ],
  summary: "2 measured creative(s) on this deployment; top by trueROAS listed.",
};

describe("renderPastPerformanceBlock", () => {
  it("renders numbers per performer + the summary under the measured heading", () => {
    const block = renderPastPerformanceBlock(HISTORY);
    expect(block).toContain("**PAST PERFORMANCE (measured):**");
    expect(block).toContain("- polished:question: 5.0x trueROAS, $50.00 spent, $250.00 booked");
    expect(block).toContain("- polished:bold_statement: trueROAS unknown, $12.50 spent");
    expect(block).toContain("2 measured creative(s)");
  });

  it("renders nothing for null/undefined/empty history", () => {
    expect(renderPastPerformanceBlock(null)).toBe("");
    expect(renderPastPerformanceBlock(undefined)).toBe("");
    expect(renderPastPerformanceBlock({ ...HISTORY, topPerformers: [] })).toBe("");
  });
});

describe("renderTasteBlock", () => {
  it("renders bullets under the clearly subjective heading", () => {
    const block = renderTasteBlock([
      "consistently keeps question hooks in polished mode (4 keeps)",
    ]);
    expect(block).toContain("**OPERATOR TASTE (subjective, from review gestures):**");
    expect(block).toContain("- consistently keeps question hooks");
  });

  it("renders nothing for undefined/empty input", () => {
    expect(renderTasteBlock(undefined)).toBe("");
    expect(renderTasteBlock([])).toBe("");
  });
});
