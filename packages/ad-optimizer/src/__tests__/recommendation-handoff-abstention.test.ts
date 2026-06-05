import { describe, it, expect } from "vitest";
import {
  shouldAbstainFromHandoff,
  CREATIVE_HANDOFF_ACTIONS,
} from "../recommendation-handoff-abstention.js";

describe("shouldAbstainFromHandoff", () => {
  it("abstains when below the evidence floor", () => {
    const r = shouldAbstainFromHandoff({
      actionType: "add_creative",
      evidence: { clicks: 5, conversions: 0, days: 1 },
      learningPhaseActive: false,
    });
    expect(r.abstain).toBe(true);
    expect(r.reason).toBe("below_evidence_floor");
  });

  it("abstains when the action resets learning during an active learning phase", () => {
    const r = shouldAbstainFromHandoff({
      actionType: "refresh_creative", // resetsLearning === "yes"
      evidence: { clicks: 1000, conversions: 100, days: 30 },
      learningPhaseActive: true,
    });
    expect(r.abstain).toBe(true);
    expect(r.reason).toBe("learning_locked");
  });

  it("does NOT abstain for a well-evidenced refresh outside a learning phase", () => {
    const r = shouldAbstainFromHandoff({
      actionType: "refresh_creative",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
      learningPhaseActive: false,
    });
    expect(r.abstain).toBe(false);
  });

  it("abstains for a non-creative action (unroutable to Mira)", () => {
    const r = shouldAbstainFromHandoff({
      actionType: "pause",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
      learningPhaseActive: false,
    });
    expect(r.abstain).toBe(true);
    expect(r.reason).toBe("unroutable_action");
  });

  it("CREATIVE_HANDOFF_ACTIONS contains exactly the Mira-routable actions", () => {
    expect([...CREATIVE_HANDOFF_ACTIONS].sort()).toEqual(["add_creative", "refresh_creative"]);
  });
});
