import { describe, it, expect } from "vitest";
import { InMemoryGuardrailStateStore } from "../guardrail-state/in-memory.js";

describe("InMemoryGuardrailStateStore", () => {
  it("should return empty maps for unknown keys", async () => {
    const store = new InMemoryGuardrailStateStore();

    const rateLimits = await store.getRateLimits(["unknown:key"]);
    expect(rateLimits.size).toBe(0);

    const cooldowns = await store.getCooldowns(["unknown:key"]);
    expect(cooldowns.size).toBe(0);
  });

  it("should round-trip rate limit entries", async () => {
    const store = new InMemoryGuardrailStateStore();

    const entry = { count: 5, windowStart: Date.now() };
    await store.setRateLimit("user:ads.campaign.pause", entry, 60_000);

    const result = await store.getRateLimits(["user:ads.campaign.pause"]);
    expect(result.size).toBe(1);
    expect(result.get("user:ads.campaign.pause")).toEqual(entry);
  });

  it("should not return expired rate limit entries", async () => {
    const store = new InMemoryGuardrailStateStore();

    const entry = { count: 3, windowStart: Date.now() - 10_000 };
    // Set with 1ms TTL — will expire immediately
    await store.setRateLimit("user:ads.campaign.pause", entry, 1);

    // Wait a tick to ensure expiry
    await new Promise((r) => setTimeout(r, 5));

    const result = await store.getRateLimits(["user:ads.campaign.pause"]);
    expect(result.size).toBe(0);
  });

  it("should round-trip cooldown entries", async () => {
    const store = new InMemoryGuardrailStateStore();

    const timestamp = Date.now();
    await store.setCooldown("entity:ent_1", timestamp, 60_000);

    const result = await store.getCooldowns(["entity:ent_1"]);
    expect(result.size).toBe(1);
    expect(result.get("entity:ent_1")).toBe(timestamp);
  });

  it("should not return expired cooldown entries", async () => {
    const store = new InMemoryGuardrailStateStore();

    await store.setCooldown("entity:ent_1", Date.now(), 1);

    await new Promise((r) => setTimeout(r, 5));

    const result = await store.getCooldowns(["entity:ent_1"]);
    expect(result.size).toBe(0);
  });

  it("should load multiple keys in one batch call", async () => {
    const store = new InMemoryGuardrailStateStore();

    const now = Date.now();
    await store.setRateLimit("user:action1", { count: 1, windowStart: now }, 60_000);
    await store.setRateLimit("user:action2", { count: 2, windowStart: now }, 60_000);
    await store.setRateLimit("user:action3", { count: 3, windowStart: now }, 60_000);

    const result = await store.getRateLimits([
      "user:action1",
      "user:action2",
      "user:action3",
      "user:missing",
    ]);

    expect(result.size).toBe(3);
    expect(result.get("user:action1")?.count).toBe(1);
    expect(result.get("user:action2")?.count).toBe(2);
    expect(result.get("user:action3")?.count).toBe(3);
    expect(result.has("user:missing")).toBe(false);
  });
});
