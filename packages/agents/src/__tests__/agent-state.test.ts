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
});
