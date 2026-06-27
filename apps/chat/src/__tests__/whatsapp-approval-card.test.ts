import { describe, it, expect, vi, afterEach } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

// CHAN-9: WhatsApp interactive approval cards are capped at 3 reply buttons with
// 20-char titles so a card never exceeds the platform's button limits.
describe("WhatsAppAdapter — sendApprovalCard button limits (CHAN-9)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps approval buttons at 3 with 20-char titles", async () => {
    const adapter = new WhatsAppAdapter({ token: "t", phoneNumberId: "123456789" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 }),
      );

    await adapter.sendApprovalCard("15551234567", {
      summary: "Pause campaign",
      riskCategory: "medium",
      explanation: "Budget exceeds limit",
      buttons: Array.from({ length: 5 }, (_, i) => ({
        label: `A very long approval button label ${i}`,
        callbackData: `cb_${i}`,
      })),
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    const buttons = body.interactive.action.buttons as Array<{ reply: { title: string } }>;
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      expect(b.reply.title.length).toBeLessThanOrEqual(20);
    }
  });
});
