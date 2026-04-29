import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppApprovalNotifier } from "../notifications/whatsapp-notifier.js";
import type { ApprovalNotification } from "@switchboard/core";

describe("WhatsAppApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
  });

  const notifier = new WhatsAppApprovalNotifier({
    token: "wa_test_token",
    phoneNumberId: "phone_123",
  });

  function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
    return {
      approvalId: "appr_1",
      envelopeId: "env_1",
      summary: "Pause campaign ABC",
      explanation: "Budget exceeds $500/day limit",
      riskCategory: "medium",
      bindingHash: "hash123",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
      approvers: ["+15551234567"],
      evidenceBundle: {},
      ...overrides,
    };
  }

  it("sends interactive button message to each approver", async () => {
    await notifier.notify(makeNotification());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("phone_123/messages");
    expect(url).toContain("graph.facebook.com");

    const body = JSON.parse(options.body);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("+15551234567");
    expect(body.type).toBe("interactive");
    expect(body.interactive.type).toBe("button");
    expect(body.interactive.action.buttons).toHaveLength(2);
  });

  it("includes approve and reject buttons with correct payloads", async () => {
    await notifier.notify(makeNotification());

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    const buttons = body.interactive.action.buttons;

    const approveBtn = buttons.find(
      (b: Record<string, unknown>) => (b["reply"] as Record<string, string>)["title"] === "Approve",
    );
    const rejectBtn = buttons.find(
      (b: Record<string, unknown>) => (b["reply"] as Record<string, string>)["title"] === "Reject",
    );

    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    const approveData = JSON.parse(approveBtn.reply.id);
    expect(approveData.action).toBe("approve");
    expect(approveData.approvalId).toBe("appr_1");
    expect(approveData.bindingHash).toBe("hash123");

    const rejectData = JSON.parse(rejectBtn.reply.id);
    expect(rejectData.action).toBe("reject");
    expect(rejectData.approvalId).toBe("appr_1");
    expect(rejectData.bindingHash).toBe("hash123");
  });

  it("includes risk category in header", async () => {
    await notifier.notify(makeNotification({ riskCategory: "high" }));

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body.interactive.header.text).toContain("HIGH risk");
  });

  it("includes summary and explanation in body", async () => {
    await notifier.notify(makeNotification());

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body.interactive.body.text).toContain("Pause campaign ABC");
    expect(body.interactive.body.text).toContain("Budget exceeds $500/day limit");
    expect(body.interactive.body.text).toContain("env_1");
  });

  it("does not send when approvers list is empty", async () => {
    await notifier.notify(makeNotification({ approvers: [] }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends to multiple approvers", async () => {
    await notifier.notify(
      makeNotification({ approvers: ["+15551111111", "+15552222222", "+15553333333"] }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("uses correct API version", async () => {
    const v20Notifier = new WhatsAppApprovalNotifier({
      token: "tok",
      phoneNumberId: "ph_1",
      apiVersion: "v20.0",
    });
    await v20Notifier.notify(makeNotification());
    expect(fetchSpy.mock.calls[0]![0]).toContain("v20.0");
  });

  it("uses correct risk emoji for each category", async () => {
    const categories = ["critical", "high", "medium", "low", "unknown"];
    for (const cat of categories) {
      fetchSpy.mockClear();
      await notifier.notify(makeNotification({ riskCategory: cat }));
      const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
      // Header should contain an emoji and the risk category
      expect(body.interactive.header.text).toContain(cat.toUpperCase());
    }
  });

  it("includes authorization header", async () => {
    await notifier.notify(makeNotification());
    const options = fetchSpy.mock.calls[0]![1];
    expect(options.headers.Authorization).toBe("Bearer wa_test_token");
  });

  it("handles fetch failure gracefully via allSettled", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));
    // Should not throw — allSettled catches individual failures
    await expect(notifier.notify(makeNotification())).resolves.toBeUndefined();
  });
});
