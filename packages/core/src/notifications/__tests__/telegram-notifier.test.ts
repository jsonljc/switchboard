import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramApprovalNotifier } from "../telegram-notifier.js";
import type { ApprovalNotification } from "../notifier.js";

describe("TelegramApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
    return {
      approvalId: "appr_1",
      envelopeId: "env_1",
      summary: "Pause campaign ABC",
      explanation: "Budget exceeds limit",
      riskCategory: "medium",
      bindingHash: "hash123",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      approvers: ["12345"],
      evidenceBundle: {},
      ...overrides,
    };
  }

  it("emits Approve and Reject button payloads that both include bindingHash", async () => {
    const notifier = new TelegramApprovalNotifier("test_bot_token");

    await notifier.notify(makeNotification());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);

    const buttons = body.reply_markup.inline_keyboard.flat() as Array<{
      text: string;
      callback_data: string;
    }>;
    const approveBtn = buttons.find((b) => b.text === "Approve");
    const rejectBtn = buttons.find((b) => b.text === "Reject");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    const approveData = JSON.parse(approveBtn!.callback_data);
    expect(approveData).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });

    const rejectData = JSON.parse(rejectBtn!.callback_data);
    expect(rejectData).toEqual({
      action: "reject",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });
});
