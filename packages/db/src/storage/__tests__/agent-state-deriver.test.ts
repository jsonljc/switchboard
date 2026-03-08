import { describe, it, expect } from "vitest";
import { deriveAgentStates } from "../agent-state-deriver.js";

describe("deriveAgentStates", () => {
  it("initializes all roles as idle when no entries", () => {
    const states = deriveAgentStates([]);
    expect(states.size).toBe(7);
    for (const state of states.values()) {
      expect(state.activityStatus).toBe("idle");
      expect(state.currentTask).toBeNull();
      expect(state.lastActionAt).toBeNull();
      expect(state.metrics.actionsToday).toBe(0);
    }
  });

  it("maps campaign events to strategist", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.executed",
        timestamp: new Date(),
        summary: "Updated campaign budget to $500",
      },
    ]);
    const strategist = states.get("strategist")!;
    expect(strategist.lastActionSummary).toBe("Updated campaign budget to $500");
    expect(strategist.metrics.actionsToday).toBe(1);
  });

  it("maps monitor events to monitor", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.executed",
        timestamp: new Date(),
        summary: "Anomaly detected in ad group performance",
      },
    ]);
    const monitor = states.get("monitor")!;
    expect(monitor.lastActionSummary).toContain("Anomaly");
  });

  it("maps lead/conversation events to responder", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.executed",
        timestamp: new Date(),
        summary: "Responded to lead inquiry",
      },
    ]);
    const responder = states.get("responder")!;
    expect(responder.lastActionSummary).toContain("lead");
  });

  it("maps governance denied events to guardian", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.denied",
        timestamp: new Date(),
        summary: "Governance rule blocked action",
      },
    ]);
    const guardian = states.get("guardian")!;
    expect(guardian.activityStatus).toBe("idle");
    expect(guardian.lastActionSummary).toContain("Governance");
  });

  it("maps unrecognized events to primary_operator", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.executed",
        timestamp: new Date(),
        summary: "Performed general task",
      },
    ]);
    const primary = states.get("primary_operator")!;
    expect(primary.lastActionSummary).toBe("Performed general task");
  });

  it("sets waiting_approval status for pending events", () => {
    const states = deriveAgentStates([
      {
        eventType: "action.pending_approval",
        timestamp: new Date(),
        summary: "Campaign budget increase needs approval",
      },
    ]);
    const strategist = states.get("strategist")!;
    expect(strategist.activityStatus).toBe("waiting_approval");
  });

  it("counts only today's actions in metrics", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const states = deriveAgentStates([
      {
        eventType: "action.executed",
        timestamp: yesterday,
        summary: "Old campaign update",
      },
      {
        eventType: "action.executed",
        timestamp: new Date(),
        summary: "New campaign update",
      },
    ]);
    const strategist = states.get("strategist")!;
    expect(strategist.metrics.actionsToday).toBe(1);
  });
});
