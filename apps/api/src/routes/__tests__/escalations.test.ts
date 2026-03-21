import { describe, it, expect } from "vitest";

interface EscalationSummary {
  id: string;
  sessionId: string;
  status: string;
  reason: string;
  conversationSummary: Record<string, unknown>;
  createdAt: string;
}

function filterByStatus(escalations: EscalationSummary[], status: string): EscalationSummary[] {
  return escalations.filter((e) => e.status === status);
}

describe("Escalation Inbox", () => {
  it("filters escalations by status", () => {
    const items: EscalationSummary[] = [
      {
        id: "1",
        sessionId: "s1",
        status: "pending",
        reason: "low_confidence",
        conversationSummary: {},
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        sessionId: "s2",
        status: "active",
        reason: "max_turns",
        conversationSummary: {},
        createdAt: new Date().toISOString(),
      },
      {
        id: "3",
        sessionId: "s3",
        status: "pending",
        reason: "sensitive_topic",
        conversationSummary: {},
        createdAt: new Date().toISOString(),
      },
    ];

    const pending = filterByStatus(items, "pending");
    expect(pending).toHaveLength(2);
  });
});
