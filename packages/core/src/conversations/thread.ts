import { randomUUID } from "node:crypto";
import type { ConversationThread } from "@switchboard/schemas";

/** Regenerate summary every N messages */
export const SUMMARY_REFRESH_INTERVAL = 10;

/**
 * Creates a default ConversationThread for a brand-new contact.
 */
export function createDefaultThread(contactId: string, organizationId: string): ConversationThread {
  const now = new Date();
  return {
    id: randomUUID(),
    contactId,
    organizationId,
    stage: "new",
    threadStatus: "open",
    assignedAgent: "employee-a",
    agentContext: {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown",
    },
    currentSummary: "",
    followUpSchedule: {
      nextFollowUpAt: null,
      reason: null,
      cadenceId: null,
    },
    lastOutcomeAt: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
