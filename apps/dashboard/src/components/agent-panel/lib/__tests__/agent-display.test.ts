import { describe, expect, it } from "vitest";
import { agentDisplay, labelForHeroKind } from "@/components/agent-panel/lib/agent-display";

describe("agentDisplay", () => {
  it("maps each agent to display name + role copy (not the internal slug)", () => {
    expect(agentDisplay.alex).toEqual({ name: "Alex", role: "Lead response" });
    expect(agentDisplay.riley).toEqual({ name: "Riley", role: "Ad optimizer" });
    expect(agentDisplay.mira).toEqual({ name: "Mira", role: "Creative" });
  });
});

describe("labelForHeroKind", () => {
  it("renders medspa-correct labels from kind (never 'tours')", () => {
    expect(labelForHeroKind("tours-booked")).toBe("consults booked");
    expect(labelForHeroKind("ad-leads")).toBe("leads");
    expect(labelForHeroKind("creatives-shipped")).toBe("creatives shipped");
    expect(labelForHeroKind("revenue-attributed")).toBe("attributed");
  });
});
