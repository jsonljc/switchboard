import { describe, it, expect, vi, afterEach } from "vitest";
import { ProactiveSender, WhatsAppWindowClosedError } from "./proactive-sender.js";

const WA_CREDS = { whatsapp: { token: "t", phoneNumberId: "pn" } };

describe("ProactiveSender — phone masking in logs (F10/PDPA)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("masks the recipient phone in the 24h-window-closed error", async () => {
    const sender = new ProactiveSender({
      credentials: WA_CREDS,
      isWithinWindow: async () => false,
    });

    // The window is closed with no approved template: the send must THROW (so the
    // caller can roll back and surface an honest failure) rather than report
    // success. The thrown error masks the recipient phone (F10/PDPA).
    const err = await sender
      .sendProactive("+6591234567", "whatsapp", "hello")
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WhatsAppWindowClosedError);
    const message = (err as Error).message;
    expect(message).toContain("…4567");
    expect(message).not.toContain("6591234567");
    expect(message).not.toContain("+6591234567");
  });

  it("masks the phone in the rate-limit warning on the whatsapp channel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK" })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The window is open, so 20 sends deliver and consume the daily budget; the
    // 21st trips the rate limiter, whose warning masks the WhatsApp phone.
    const sender = new ProactiveSender({
      credentials: WA_CREDS,
      isWithinWindow: async () => true,
    });

    for (let i = 0; i < 21; i++) await sender.sendProactive("+6591234567", "whatsapp", "hello");

    const rateLimitLine = warn.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("Rate limit reached"));
    expect(rateLimitLine).toBeDefined();
    expect(rateLimitLine).toContain("…4567");
    expect(rateLimitLine).not.toContain("6591234567");
  });

  it("does NOT mask a non-phone telegram chat id in the rate-limit warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK" })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sender = new ProactiveSender({ telegram: { botToken: "b" } });
    const chatId = "111122223333"; // telegram numeric id — NOT a phone

    for (let i = 0; i < 21; i++) await sender.sendProactive(chatId, "telegram", "hello");

    const rateLimitLine = warn.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("Rate limit reached"));
    expect(rateLimitLine).toBeDefined();
    expect(rateLimitLine).toContain(chatId); // full id preserved for non-phone channels
    expect(rateLimitLine).not.toContain("…3333");
  });
});
