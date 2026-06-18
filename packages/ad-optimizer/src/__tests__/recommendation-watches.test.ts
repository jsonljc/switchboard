// packages/ad-optimizer/src/__tests__/recommendation-watches.test.ts
import { describe, it, expect } from "vitest";
import { insufficientEvidenceWatch } from "../recommendation-watches.js";

const base = { campaignId: "camp-1", campaignName: "Test Campaign" };

describe("insufficientEvidenceWatch", () => {
  it("builds an insufficient_evidence watch carrying the campaign identity and a blank checkBackDate", () => {
    const watch = insufficientEvidenceWatch(base, "pause", { clicks: 3, conversions: 0 });
    expect(watch.type).toBe("watch");
    expect(watch.pattern).toBe("insufficient_evidence");
    expect(watch.campaignId).toBe("camp-1");
    expect(watch.campaignName).toBe("Test Campaign");
    // The engine leaves checkBackDate blank; campaign-decision.ts fills it from nextCycleDate.
    expect(watch.checkBackDate).toBe("");
  });

  it("names the action and the evidence counts in the message", () => {
    const watch = insufficientEvidenceWatch(base, "add_creative", { clicks: 12, conversions: 1 });
    expect(watch.message).toContain("add_creative");
    expect(watch.message).toContain("12 clicks");
    expect(watch.message).toContain("1 conversions");
  });
});
