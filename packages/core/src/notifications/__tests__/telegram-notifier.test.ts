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

  it("emits Approve and Reject buttons with bindingHash when callback_data fits", async () => {
    const notifier = new TelegramApprovalNotifier("test_bot_token");

    // Small ids keep the JSON callback_data within Telegram's 64-byte limit.
    await notifier.notify(makeNotification({ approvalId: "appr_1", bindingHash: "h" }));

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

    expect(JSON.parse(approveBtn!.callback_data)).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "h",
    });
    expect(JSON.parse(rejectBtn!.callback_data)).toEqual({
      action: "reject",
      approvalId: "appr_1",
      bindingHash: "h",
    });
    for (const b of buttons) {
      expect(Buffer.byteLength(b.callback_data, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  // CHAN-4 / BUG-4: a real approval's callback_data
  // (`{action, appr_<uuid>, <sha256 hex hash>}`) is ~150 bytes. Telegram rejects
  // the whole sendMessage when callback_data exceeds 64 bytes, so the card must
  // still be delivered without the inline buttons (dashboard fallback) and the
  // drop must be observable.
  it("omits the keyboard and falls back to the dashboard when callback_data is oversized", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notifier = new TelegramApprovalNotifier("test_bot_token");

    await notifier.notify(
      makeNotification({
        approvalId: "appr_550e8400-e29b-41d4-a716-446655440000",
        bindingHash: "a".repeat(64),
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);

    // No inline keyboard (it would make Telegram reject the whole message)...
    expect(body.reply_markup).toBeUndefined();
    // ...but the card text is still delivered, with the dashboard fallback...
    expect(body.text).toContain("Approve or reject this from the dashboard");
    // ...and the drop is observable.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
