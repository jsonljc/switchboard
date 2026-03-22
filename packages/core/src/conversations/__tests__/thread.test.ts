import { describe, it, expect } from "vitest";
import { createDefaultThread, SUMMARY_REFRESH_INTERVAL } from "../thread.js";

describe("ConversationThread helpers", () => {
  it("creates a default thread for a new contact", () => {
    const thread = createDefaultThread("c-1", "org-1");
    expect(thread.contactId).toBe("c-1");
    expect(thread.organizationId).toBe("org-1");
    expect(thread.stage).toBe("new");
    expect(thread.assignedAgent).toBe("lead-responder");
    expect(thread.messageCount).toBe(0);
    expect(thread.currentSummary).toBe("");
    expect(thread.agentContext.objectionsEncountered).toEqual([]);
    expect(thread.agentContext.sentimentTrend).toBe("unknown");
    expect(thread.followUpSchedule.nextFollowUpAt).toBeNull();
  });

  it("exposes SUMMARY_REFRESH_INTERVAL constant", () => {
    expect(SUMMARY_REFRESH_INTERVAL).toBe(10);
  });
});
