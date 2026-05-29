import { describe, expect, it } from "vitest";
import {
  agentDisplay,
  labelForHeroKind,
  parsePanelAgentKey,
} from "@/components/agent-panel/lib/agent-display";

describe("agentDisplay", () => {
  it("maps each agent to display name + role copy (not the internal slug)", () => {
    expect(agentDisplay.alex).toEqual({ name: "Alex", role: "Lead response" });
    expect(agentDisplay.riley).toEqual({ name: "Riley", role: "Ad optimizer" });
    expect(agentDisplay.mira).toEqual({ name: "Mira", role: "Creative" });
  });
});

describe("parsePanelAgentKey", () => {
  it("returns the key for each known panel agent", () => {
    expect(parsePanelAgentKey("alex")).toBe("alex");
    expect(parsePanelAgentKey("riley")).toBe("riley");
    expect(parsePanelAgentKey("mira")).toBe("mira");
  });

  it("returns null for unknown, empty, or non-string values", () => {
    expect(parsePanelAgentKey("nova")).toBeNull();
    expect(parsePanelAgentKey("")).toBeNull();
    expect(parsePanelAgentKey(undefined)).toBeNull();
    expect(parsePanelAgentKey(null)).toBeNull();
    expect(parsePanelAgentKey(42)).toBeNull();
    expect(parsePanelAgentKey(["alex"])).toBeNull();
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
