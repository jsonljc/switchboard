import { describe, it, expect } from "vitest";
import { IdempotencyGuard, InMemoryIdempotencyStore } from "../idempotency/guard.js";

describe("IdempotencyGuard", () => {
  it("generates deterministic keys for same inputs", () => {
    const k1 = IdempotencyGuard.generateKey("user-1", "crm.contact.create", { name: "Alice" });
    const k2 = IdempotencyGuard.generateKey("user-1", "crm.contact.create", { name: "Alice" });
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64); // sha256 hex
  });

  it("generates different keys for different inputs", () => {
    const k1 = IdempotencyGuard.generateKey("user-1", "crm.contact.create", { name: "Alice" });
    const k2 = IdempotencyGuard.generateKey("user-1", "crm.contact.create", { name: "Bob" });
    const k3 = IdempotencyGuard.generateKey("user-2", "crm.contact.create", { name: "Alice" });
    const k4 = IdempotencyGuard.generateKey("user-1", "crm.deal.create", { name: "Alice" });

    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).not.toBe(k4);
  });

  it("generates consistent keys regardless of parameter key order", () => {
    const k1 = IdempotencyGuard.generateKey("user-1", "action", { a: 1, b: 2 });
    const k2 = IdempotencyGuard.generateKey("user-1", "action", { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it("detects no duplicate on first call", async () => {
    const guard = new IdempotencyGuard();
    const result = await guard.checkDuplicate("user-1", "crm.contact.create", { name: "Alice" });
    expect(result.isDuplicate).toBe(false);
    expect(result.cachedResponse).toBeNull();
  });

  it("detects duplicate after recording a response", async () => {
    const guard = new IdempotencyGuard();
    const params = { name: "Alice" };
    const mockResponse = { envelope: { id: "env_123" }, denied: false };

    // First call: not duplicate
    const first = await guard.checkDuplicate("user-1", "crm.contact.create", params);
    expect(first.isDuplicate).toBe(false);

    // Record response
    await guard.recordResponse("user-1", "crm.contact.create", params, mockResponse);

    // Second call: duplicate
    const second = await guard.checkDuplicate("user-1", "crm.contact.create", params);
    expect(second.isDuplicate).toBe(true);
    expect(second.cachedResponse).toEqual(mockResponse);
  });

  it("different parameters are not considered duplicates", async () => {
    const guard = new IdempotencyGuard();

    await guard.recordResponse("user-1", "crm.contact.create", { name: "Alice" }, { id: "1" });

    const result = await guard.checkDuplicate("user-1", "crm.contact.create", { name: "Bob" });
    expect(result.isDuplicate).toBe(false);
  });

  it("respects TTL expiration", async () => {
    const guard = new IdempotencyGuard({ defaultTtlMs: 50 });
    const params = { name: "Alice" };

    await guard.recordResponse("user-1", "crm.contact.create", params, { id: "1" });

    // Immediately: still duplicate
    const before = await guard.checkDuplicate("user-1", "crm.contact.create", params);
    expect(before.isDuplicate).toBe(true);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    const after = await guard.checkDuplicate("user-1", "crm.contact.create", params);
    expect(after.isDuplicate).toBe(false);
  });

  it("uses custom store when provided", async () => {
    const customStore = new InMemoryIdempotencyStore();
    const guard = new IdempotencyGuard({ store: customStore });
    const params = { name: "Alice" };

    await guard.recordResponse("user-1", "action", params, { ok: true });

    // Verify via the custom store directly
    const key = IdempotencyGuard.generateKey("user-1", "action", params);
    const entry = await customStore.get(key);
    expect(entry).not.toBeNull();
    expect(entry!.response).toEqual({ ok: true });
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("returns null for missing key", async () => {
    const store = new InMemoryIdempotencyStore();
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("stores and retrieves values", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set("key1", { data: "test" }, 60_000);

    const result = await store.get("key1");
    expect(result).not.toBeNull();
    expect(result!.response).toEqual({ data: "test" });
    expect(result!.createdAt).toBeInstanceOf(Date);
  });

  it("expires entries after TTL", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set("key1", { data: "test" }, 50);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await store.get("key1");
    expect(result).toBeNull();
  });
});
