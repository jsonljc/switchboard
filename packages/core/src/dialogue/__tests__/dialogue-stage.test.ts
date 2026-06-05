import { describe, it, expect } from "vitest";
import { emotionalSignalToStage } from "../dialogue-stage.js";
import type { EmotionalSignal } from "../types.js";

function signal(overrides: Partial<EmotionalSignal> = {}): EmotionalSignal {
  return {
    valence: "neutral",
    engagement: "medium",
    intentClarity: "clear",
    concernType: "none",
    urgencySignal: "none",
    localMarker: "none",
    confidence: 0.5,
    ...overrides,
  };
}

describe("emotionalSignalToStage", () => {
  it("maps a fear concern to the fear stage", () => {
    expect(emotionalSignalToStage(signal({ concernType: "fear" }))).toBe("fear");
  });

  it("maps ready_now urgency to the closing stage", () => {
    expect(emotionalSignalToStage(signal({ urgencySignal: "ready_now" }))).toBe("closing");
  });

  it("maps price / trust / timing / comparison concerns to the objection stage", () => {
    for (const concernType of ["price", "trust", "timing", "comparison"] as const) {
      expect(emotionalSignalToStage(signal({ concernType }))).toBe("objection");
    }
  });

  it("returns undefined when there is no escalating signal", () => {
    expect(emotionalSignalToStage(signal())).toBeUndefined();
    expect(emotionalSignalToStage(signal({ urgencySignal: "exploring" }))).toBeUndefined();
    expect(emotionalSignalToStage(signal({ urgencySignal: "soon" }))).toBeUndefined();
  });

  it("prefers fear over closing when both are present", () => {
    expect(
      emotionalSignalToStage(signal({ concernType: "fear", urgencySignal: "ready_now" })),
    ).toBe("fear");
  });
});
