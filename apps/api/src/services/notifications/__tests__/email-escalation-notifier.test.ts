import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailEscalationNotifier } from "../email-escalation-notifier.js";
import type { ApprovalNotification } from "@switchboard/core/notifications";

const mockSend = vi.fn().mockResolvedValue({ id: "email_1" });

vi.mock("resend", () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
  };
});

function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
  return {
    approvalId: "approval_1",
    envelopeId: "env_1",
    summary: "Lead requires manual review",
    riskCategory: "high",
    explanation: "Unusual spending pattern detected",
    bindingHash: "hash_abc",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    approvers: ["owner@example.com"],
    evidenceBundle: {},
    ...overrides,
  };
}

describe("EmailEscalationNotifier", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it("sends email to all approvers", async () => {
    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification({ approvers: ["a@test.com", "b@test.com"] }));

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("skips when no approvers", async () => {
    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification({ approvers: [] }));

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("includes escalation link in email body", async () => {
    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification());

    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0]?.[0] as { html: string; subject: string };
    expect(callArgs.html).toContain("https://app.switchboard.app/escalations/approval_1");
    expect(callArgs.subject).toContain("HIGH");
  });
});
