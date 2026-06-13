import { describe, it, expect } from "vitest";
import { deriveAgentStates, ACTIVITY_STATUS_STALE_MS } from "../agent-state-deriver.js";

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

describe("activityStatus time-decay", () => {
  const NOW = new Date("2026-06-13T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it("decays a stale working status to idle past the inactivity window", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS + 60_000),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    const strategist = states.get("strategist")!;
    expect(strategist.activityStatus).toBe("idle");
    expect(strategist.lastActionSummary).toBe("Proposed campaign budget increase");
  });

  it("keeps a recent working status active within the window", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(60_000),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("working");
  });

  it("keeps working exactly at the threshold and decays just past it", () => {
    const atThreshold = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(atThreshold.get("strategist")!.activityStatus).toBe("working");

    const pastThreshold = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS + 1),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(pastThreshold.get("strategist")!.activityStatus).toBe("idle");
  });

  it("does not decay waiting_approval even when stale", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.pending_approval",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS * 10),
          summary: "Campaign budget increase needs approval",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("waiting_approval");
  });

  it("does not decay error even when stale", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.error",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS * 10),
          summary: "Campaign update failed",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("error");
  });

  it("decays to idle when the timestamp is invalid (NaN-guarded comparison)", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: new Date(NaN),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("idle");
  });
});
