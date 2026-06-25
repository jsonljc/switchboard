import { describe, it, expect, vi } from "vitest";
import { HandoffNotifier } from "../handoff-notifier.js";
import type { Handoff } from "../types.js";

function makePkg(overrides: Partial<Handoff> = {}): Handoff {
  return {
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
    ...overrides,
  };
}

describe("HandoffNotifier", () => {
  it("should format and send notification", async () => {
    const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const resolveApprovers = vi.fn().mockResolvedValue(["ops@org-789.com"]);

    const notifier = new HandoffNotifier(mockNotifier, resolveApprovers);
    await notifier.notify(makePkg());

    expect(mockNotifier.notify).toHaveBeenCalledOnce();
    const call = mockNotifier.notify.mock.calls[0]![0];
    expect(call.approvalId).toBe("handoff_123");
    expect(call.summary).toContain("HANDOFF REQUEST");
    expect(call.summary).toContain("Jane");
    expect(call.summary).toContain("dental implants");
    expect(call.summary).toContain("price concern");
  });

  // P1-B: handoff recipients MUST be resolved per-org from pkg.organizationId, not
  // a process-global list. Previously every tenant's handoff (carrying leadSnapshot
  // PII) was broadcast to one shared ESCALATION_EMAIL / ESCALATION_CHAT_ID inbox.
  it("resolves recipients per-org from pkg.organizationId", async () => {
    const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const resolveApprovers = vi.fn().mockResolvedValue(["ops@org-789.com"]);

    const notifier = new HandoffNotifier(mockNotifier, resolveApprovers);
    await notifier.notify(makePkg({ organizationId: "org_789" }));

    expect(resolveApprovers).toHaveBeenCalledWith("org_789");
    expect(mockNotifier.notify.mock.calls[0]![0].approvers).toEqual(["ops@org-789.com"]);
  });

  it("routes different orgs to different recipients (no shared global inbox)", async () => {
    const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const recipientsByOrg: Record<string, string[]> = {
      org_a: ["a@a.com"],
      org_b: ["b@b.com"],
    };
    const resolveApprovers = vi.fn(async (orgId: string) => recipientsByOrg[orgId] ?? []);

    const notifier = new HandoffNotifier(mockNotifier, resolveApprovers);
    await notifier.notify(makePkg({ organizationId: "org_a" }));
    await notifier.notify(makePkg({ organizationId: "org_b" }));

    expect(resolveApprovers).toHaveBeenNthCalledWith(1, "org_a");
    expect(resolveApprovers).toHaveBeenNthCalledWith(2, "org_b");
    expect(mockNotifier.notify.mock.calls[0]![0].approvers).toEqual(["a@a.com"]);
    expect(mockNotifier.notify.mock.calls[1]![0].approvers).toEqual(["b@b.com"]);
  });
});
