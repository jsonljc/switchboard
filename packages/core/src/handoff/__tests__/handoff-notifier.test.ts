import { describe, it, expect, vi } from "vitest";
import { HandoffNotifier } from "../handoff-notifier.js";
import type { HandoffPackage } from "../types.js";

describe("HandoffNotifier", () => {
  it("should format and send notification", async () => {
    const mockNotifier = {
      notify: vi.fn().mockResolvedValue(undefined),
    };

    const notifier = new HandoffNotifier(mockNotifier);

    const pkg: HandoffPackage = {
      id: "handoff_123",
      sessionId: "session_456",
      organizationId: "org_789",
      reason: "human_requested",
      status: "pending",
      leadSnapshot: {
        name: "Jane",
        channel: "whatsapp",
        serviceInterest: "dental implants",
      },
      qualificationSnapshot: {
        signalsCaptured: {},
        qualificationStage: "qualifying",
      },
      conversationSummary: {
        turnCount: 5,
        keyTopics: ["pricing", "timing"],
        objectionHistory: ["price concern"],
        sentiment: "neutral",
        suggestedOpening: "Hi! Let me help with pricing.",
      },
      slaDeadlineAt: new Date(Date.now() + 30 * 60 * 1000),
      createdAt: new Date(),
    };

    await notifier.notify(pkg);

    expect(mockNotifier.notify).toHaveBeenCalledOnce();
    const call = mockNotifier.notify.mock.calls[0]![0];
    expect(call.approvalId).toBe("handoff_123");
    expect(call.summary).toContain("HANDOFF REQUEST");
    expect(call.summary).toContain("Jane");
    expect(call.summary).toContain("dental implants");
    expect(call.summary).toContain("price concern");
  });
});
