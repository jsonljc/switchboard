import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../telegram.js";

/**
 * AU-2: Telegram webhook adapter must fail closed in production when
 * `webhookSecret` is unset, and allow with a warning in dev mode.
 */
describe("TelegramAdapter — fail-closed behavior (AU-2)", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns false in production when webhookSecret is unset", () => {
    process.env["NODE_ENV"] = "production";
    const adapter = new TelegramAdapter("fake-bot-token");

    // Constructor logs an error so the misconfiguration is loud but does not throw.
    expect(errorSpy).toHaveBeenCalled();
    const ctorMessage = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(ctorMessage).toContain("TELEGRAM_WEBHOOK_SECRET");

    // verifyRequest fails closed even when no token header is supplied.
    const result = adapter.verifyRequest("{}", {});
    expect(result).toBe(false);

    // verifyRequest also fails closed when a token header IS supplied (no secret to compare).
    const resultWithHeader = adapter.verifyRequest("{}", {
      "x-telegram-bot-api-secret-token": "anything",
    });
    expect(resultWithHeader).toBe(false);
  });

  it("returns true in dev mode when webhookSecret is unset and emits a warning", () => {
    process.env["NODE_ENV"] = "development";
    const adapter = new TelegramAdapter("fake-bot-token");

    expect(errorSpy).not.toHaveBeenCalled();

    const result = adapter.verifyRequest("{}", {});
    expect(result).toBe(true);

    // The dev-mode warning is emitted on the verify call (and also at construction).
    expect(warnSpy).toHaveBeenCalled();
    const messages = warnSpy.mock.calls.map((c) => String(c[0] ?? ""));
    expect(messages.some((m) => m.includes("dev mode"))).toBe(true);
  });

  it("does not throw when constructed in production without a secret", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => new TelegramAdapter("fake-bot-token")).not.toThrow();
  });
});
