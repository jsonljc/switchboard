import { describe, it, expect } from "vitest";
import { AdRecommendationActionSchema } from "@switchboard/schemas";
import {
  ACTION_RESETS_LEARNING,
  resetsLearningFor,
  learningPhaseImpactText,
} from "./action-reset-classification.js";

describe("action reset classification", () => {
  it("classifies every action in the enum (exhaustive, no gaps)", () => {
    for (const action of AdRecommendationActionSchema.options) {
      expect(ACTION_RESETS_LEARNING[action]).toBeDefined();
    }
  });

  it("a <=20% scale does NOT reset learning (fixes the legacy wrong string)", () => {
    expect(resetsLearningFor("scale")).toBe("no");
  });

  it("creative and structural changes reset learning", () => {
    expect(resetsLearningFor("refresh_creative")).toBe("yes");
    expect(resetsLearningFor("add_creative")).toBe("yes");
    expect(resetsLearningFor("restructure")).toBe("yes");
    expect(resetsLearningFor("expand_targeting")).toBe("yes");
    expect(resetsLearningFor("consolidate")).toBe("yes");
    expect(resetsLearningFor("switch_optimization_event")).toBe("yes");
  });

  it("budget reallocation is conditional (resets only past the ~20% step)", () => {
    expect(resetsLearningFor("review_budget")).toBe("conditional");
    expect(resetsLearningFor("shift_budget_to_source")).toBe("conditional");
  });

  it("hygiene / measurement / hold actions do not reset learning", () => {
    expect(resetsLearningFor("hold")).toBe("no");
    expect(resetsLearningFor("fix_signal_health")).toBe("no");
    expect(resetsLearningFor("harden_capi_attribution")).toBe("no");
    expect(resetsLearningFor("pause")).toBe("no");
  });

  it("derives the human impact string from the structured class", () => {
    expect(learningPhaseImpactText("scale")).toBe("no impact");
    expect(learningPhaseImpactText("refresh_creative")).toBe("will reset learning");
    expect(learningPhaseImpactText("review_budget")).toBe(
      "may reset learning if the budget change exceeds ~20%",
    );
  });
});
