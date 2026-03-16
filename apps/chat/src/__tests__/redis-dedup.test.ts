import { describe, it, expect } from "vitest";
import { checkDedup } from "../dedup/redis-dedup.js";

describe("checkDedup (in-memory fallback)", () => {
  it("returns true for a new message", async () => {
    const result = await checkDedup("test", `msg_${Date.now()}_1`);
    expect(result).toBe(true);
  });

  it("returns false for a duplicate message", async () => {
    const id = `msg_${Date.now()}_2`;
    const first = await checkDedup("test", id);
    const second = await checkDedup("test", id);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("treats different channels as separate namespaces", async () => {
    const id = `msg_${Date.now()}_3`;
    const fromTelegram = await checkDedup("telegram", id);
    const fromWhatsapp = await checkDedup("whatsapp", id);
    expect(fromTelegram).toBe(true);
    expect(fromWhatsapp).toBe(true);
  });

  it("treats different message IDs as unique", async () => {
    const ts = Date.now();
    const first = await checkDedup("test", `msg_${ts}_4a`);
    const second = await checkDedup("test", `msg_${ts}_4b`);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
