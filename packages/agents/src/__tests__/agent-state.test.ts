import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentStateTracker } from "../agent-state.js";

describe("AgentStateTracker", () => {
  let tracker: AgentStateTracker;

  beforeEach(() => {
    tracker = new AgentStateTracker();
  });

  it("initializes agent state as idle", () => {
    const state = tracker.get("org-1", "lead-responder");
    expect(state).toBeUndefined();
  });

  it("tracks working state when agent starts processing", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("working");
    expect(state.currentTask).toBe("Scoring lead c1");
  });

  it("tracks completed state with summary", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");
    tracker.completeProcessing("org-1", "lead-responder", "Qualified lead c1 (score: 75, hot)");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("idle");
    expect(state.currentTask).toBeNull();
    expect(state.lastActionSummary).toBe("Qualified lead c1 (score: 75, hot)");
    expect(state.lastActiveAt).toBeDefined();
  });

  it("tracks error state", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");
    tracker.setError("org-1", "lead-responder", "Scoring function threw");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("error");
    expect(state.lastError).toBe("Scoring function threw");
  });

  it("tracks waiting_approval state", () => {
    tracker.setWaitingApproval("org-1", "sales-closer", "Booking requires approval");

    const state = tracker.get("org-1", "sales-closer")!;
    expect(state.activityStatus).toBe("waiting_approval");
    expect(state.currentTask).toBe("Booking requires approval");
  });

  it("lists all states for an org", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    tracker.completeProcessing("org-1", "lead-responder", "Done");
    tracker.startProcessing("org-1", "sales-closer", "Booking");

    const states = tracker.listForOrg("org-1");
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.agentId).sort()).toEqual(["lead-responder", "sales-closer"]);
  });

  it("increments eventsProcessed on complete", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    tracker.completeProcessing("org-1", "lead-responder", "Done");
    tracker.startProcessing("org-1", "lead-responder", "Scoring again");
    tracker.completeProcessing("org-1", "lead-responder", "Done again");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.eventsProcessed).toBe(2);
  });

  it("notifies listeners on state change", () => {
    const listener = vi.fn();
    tracker.onStateChange(listener);

    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    expect(listener).toHaveBeenCalledWith(
      "org-1",
      "lead-responder",
      expect.objectContaining({ activityStatus: "working" }),
    );
  });

  describe("memory management", () => {
    it("removes agent state for a specific org+agent", () => {
      const tracker = new AgentStateTracker();
      tracker.startProcessing("org-1", "agent-1", "task");
      tracker.completeProcessing("org-1", "agent-1", "done");
      expect(tracker.get("org-1", "agent-1")).toBeDefined();
      tracker.remove("org-1", "agent-1");
      expect(tracker.get("org-1", "agent-1")).toBeUndefined();
    });

    it("clears all state for an organization", () => {
      const tracker = new AgentStateTracker();
      tracker.startProcessing("org-1", "agent-1", "task");
      tracker.startProcessing("org-1", "agent-2", "task");
      tracker.startProcessing("org-2", "agent-1", "task");
      tracker.clearOrg("org-1");
      expect(tracker.listForOrg("org-1")).toHaveLength(0);
      expect(tracker.listForOrg("org-2")).toHaveLength(1);
    });

    it("returns unsubscribe function from onStateChange", () => {
      const tracker = new AgentStateTracker();
      const calls: string[] = [];
      const unsub = tracker.onStateChange((_org, agentId) => {
        calls.push(agentId);
      });
      tracker.startProcessing("org-1", "agent-1", "task");
      expect(calls).toEqual(["agent-1"]);
      unsub();
      tracker.startProcessing("org-1", "agent-2", "task");
      expect(calls).toEqual(["agent-1"]); // no new call after unsubscribe
    });

    it("wraps listener errors so they don't crash state updates", () => {
      const tracker = new AgentStateTracker();
      const calls: string[] = [];
      tracker.onStateChange(() => {
        throw new Error("listener boom");
      });
      tracker.onStateChange((_org, agentId) => {
        calls.push(agentId);
      });
      expect(() => tracker.startProcessing("org-1", "agent-1", "task")).not.toThrow();
      expect(calls).toEqual(["agent-1"]); // second listener still fires
    });
  });
});
