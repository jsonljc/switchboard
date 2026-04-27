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

  it("retries once on failure before recording as failed", async () => {
    mockSend.mockRejectedValue(new Error("Resend API error: 500"));

    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification({ approvers: ["fail@test.com"] }));

    // Should have attempted 2 times (initial + 1 retry)
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(notifier.lastDeliveryResults).toHaveLength(1);
    expect(notifier.lastDeliveryResults[0]?.status).toBe("failed");
    expect(notifier.lastDeliveryResults[0]?.attempts).toBe(2);
  });

  it("records delivery status for each recipient", async () => {
    // First call succeeds, second fails twice
    mockSend
      .mockResolvedValueOnce({ id: "email_1" })
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail again"));

    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification({ approvers: ["success@test.com", "fail@test.com"] }));

    expect(notifier.lastDeliveryResults).toHaveLength(2);
    expect(notifier.lastDeliveryResults[0]?.status).toBe("delivered");
    expect(notifier.lastDeliveryResults[0]?.attempts).toBe(1);
    expect(notifier.lastDeliveryResults[1]?.status).toBe("failed");
    expect(notifier.lastDeliveryResults[1]?.attempts).toBe(2);
  });

  it("succeeds on retry after initial failure", async () => {
    mockSend.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce({ id: "ok" });

    const notifier = new EmailEscalationNotifier({
      resendApiKey: "re_test_123",
      fromAddress: "noreply@switchboard.app",
      dashboardBaseUrl: "https://app.switchboard.app",
    });

    await notifier.notify(makeNotification({ approvers: ["retry@test.com"] }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(notifier.lastDeliveryResults[0]?.status).toBe("delivered");
    expect(notifier.lastDeliveryResults[0]?.attempts).toBe(2);
  });
});
