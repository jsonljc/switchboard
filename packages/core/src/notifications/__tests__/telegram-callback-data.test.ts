import { describe, it, expect } from "vitest";
import {
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  isWithinTelegramCallbackLimit,
} from "../telegram-callback-data.js";

describe("isWithinTelegramCallbackLimit (CHAN-4 / BUG-4)", () => {
  it("accepts payloads at or below 64 bytes", () => {
    expect(isWithinTelegramCallbackLimit("")).toBe(true);
    expect(isWithinTelegramCallbackLimit("a".repeat(64))).toBe(true);
    expect(TELEGRAM_CALLBACK_DATA_MAX_BYTES).toBe(64);
  });

  it("rejects payloads of 65 bytes or more", () => {
    expect(isWithinTelegramCallbackLimit("a".repeat(65))).toBe(false);
  });

  it("measures UTF-8 bytes, not string length", () => {
    // 16 multi-byte chars: 16 code units but 48 UTF-8 bytes — under the limit.
    const sixteenEmoji = "é".repeat(48); // é = 2 bytes => 96 bytes
    expect(sixteenEmoji.length).toBe(48);
    expect(Buffer.byteLength(sixteenEmoji, "utf8")).toBe(96);
    expect(isWithinTelegramCallbackLimit(sixteenEmoji)).toBe(false);

    const thirtyTwoBytes = "é".repeat(32); // 64 bytes exactly
    expect(thirtyTwoBytes.length).toBe(32);
    expect(isWithinTelegramCallbackLimit(thirtyTwoBytes)).toBe(true);
  });

  it("rejects a realistic approval callback_data JSON", () => {
    // The actual shape produced by the notifier: appr_<uuid> + sha256 hex hash.
    const realistic = JSON.stringify({
      action: "approve",
      approvalId: "appr_550e8400-e29b-41d4-a716-446655440000",
      bindingHash: "a".repeat(64),
    });
    expect(Buffer.byteLength(realistic, "utf8")).toBeGreaterThan(64);
    expect(isWithinTelegramCallbackLimit(realistic)).toBe(false);
  });
});
