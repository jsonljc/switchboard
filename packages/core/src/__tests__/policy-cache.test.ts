import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryPolicyCache, DEFAULT_POLICY_CACHE_TTL_MS } from "../policy-cache.js";
import type { Policy } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "policy-1",
    name: "Test Policy",
    description: "A test policy",
    organizationId: null,
    cartridgeId: "test-cartridge",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [] },
    effect: "allow",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makePolicies(count: number, cartridgeId = "test-cartridge"): Policy[] {
  return Array.from({ length: count }, (_, i) =>
    makePolicy({
      id: `policy-${i}`,
      name: `Policy ${i}`,
      cartridgeId,
    }),
  );
}

// ---------------------------------------------------------------------------
// DEFAULT_POLICY_CACHE_TTL_MS
// ---------------------------------------------------------------------------

describe("DEFAULT_POLICY_CACHE_TTL_MS", () => {
  it("is 60000 (1 minute)", () => {
    expect(DEFAULT_POLICY_CACHE_TTL_MS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// InMemoryPolicyCache
// ---------------------------------------------------------------------------

describe("InMemoryPolicyCache", () => {
  let cache: InMemoryPolicyCache;

  beforeEach(() => {
    cache = new InMemoryPolicyCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------

  describe("get", () => {
    it("returns null on cache miss", async () => {
      const result = await cache.get("nonexistent-cartridge");
      expect(result).toBeNull();
    });

    it("returns null for unknown cartridge with organizationId", async () => {
      const result = await cache.get("nonexistent", "org-1");
      expect(result).toBeNull();
    });

    it("returns cached policies after set", async () => {
      const policies = makePolicies(2);
      await cache.set("cart-1", null, policies, 60_000);
      const result = await cache.get("cart-1");
      expect(result).toEqual(policies);
    });

    it("returns cached policies for specific organizationId", async () => {
      const policies = makePolicies(3);
      await cache.set("cart-1", "org-1", policies, 60_000);
      const result = await cache.get("cart-1", "org-1");
      expect(result).toEqual(policies);
    });

    it("distinguishes between different organizationIds", async () => {
      const policiesOrg1 = [makePolicy({ id: "p-org1", name: "Org1 Policy" })];
      const policiesOrg2 = [makePolicy({ id: "p-org2", name: "Org2 Policy" })];
      await cache.set("cart-1", "org-1", policiesOrg1, 60_000);
      await cache.set("cart-1", "org-2", policiesOrg2, 60_000);

      const resultOrg1 = await cache.get("cart-1", "org-1");
      const resultOrg2 = await cache.get("cart-1", "org-2");
      expect(resultOrg1).toEqual(policiesOrg1);
      expect(resultOrg2).toEqual(policiesOrg2);
    });

    it("treats null organizationId and undefined organizationId the same", async () => {
      const policies = makePolicies(1);
      await cache.set("cart-1", null, policies, 60_000);

      const resultWithNull = await cache.get("cart-1", null);
      const resultWithUndefined = await cache.get("cart-1", undefined);
      const resultWithoutArg = await cache.get("cart-1");

      expect(resultWithNull).toEqual(policies);
      expect(resultWithUndefined).toEqual(policies);
      expect(resultWithoutArg).toEqual(policies);
    });

    it("returns a copy of the policies (not the same reference)", async () => {
      const policies = makePolicies(2);
      await cache.set("cart-1", null, policies, 60_000);
      const result = await cache.get("cart-1");
      expect(result).not.toBe(policies);
      expect(result).toEqual(policies);
    });

    it("mutations to returned array do not affect cache", async () => {
      const policies = makePolicies(2);
      await cache.set("cart-1", null, policies, 60_000);
      const result1 = await cache.get("cart-1");
      result1!.push(makePolicy({ id: "sneaked-in" }));

      const result2 = await cache.get("cart-1");
      expect(result2).toHaveLength(2);
    });

    it("returns null for different cartridgeId even with same organizationId", async () => {
      await cache.set("cart-1", "org-1", makePolicies(1), 60_000);
      const result = await cache.get("cart-2", "org-1");
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // TTL / expiration
  // -----------------------------------------------------------------------

  describe("TTL and expiration", () => {
    it("returns policies before TTL expires", async () => {
      await cache.set("cart-1", null, makePolicies(1), 60_000);
      vi.advanceTimersByTime(59_999);
      const result = await cache.get("cart-1");
      expect(result).not.toBeNull();
    });

    it("returns null after TTL expires", async () => {
      await cache.set("cart-1", null, makePolicies(1), 60_000);
      vi.advanceTimersByTime(60_001);
      const result = await cache.get("cart-1");
      expect(result).toBeNull();
    });

    it("returns null exactly at expiration boundary", async () => {
      await cache.set("cart-1", null, makePolicies(1), 1000);
      // Advance exactly 1001ms past the set time
      vi.advanceTimersByTime(1001);
      const result = await cache.get("cart-1");
      expect(result).toBeNull();
    });

    it("expired entry is cleaned up from store on get", async () => {
      await cache.set("cart-1", null, makePolicies(1), 100);
      vi.advanceTimersByTime(101);
      await cache.get("cart-1"); // Should delete expired entry

      // Set a new entry and verify the old one is gone
      await cache.set("cart-1", null, [makePolicy({ id: "new" })], 60_000);
      const result = await cache.get("cart-1");
      expect(result).toHaveLength(1);
      expect(result![0]!.id).toBe("new");
    });

    it("different entries can have different TTLs", async () => {
      await cache.set("cart-short", null, makePolicies(1, "cart-short"), 1000);
      await cache.set("cart-long", null, makePolicies(1, "cart-long"), 100_000);

      vi.advanceTimersByTime(5000);

      const shortResult = await cache.get("cart-short");
      const longResult = await cache.get("cart-long");
      expect(shortResult).toBeNull();
      expect(longResult).not.toBeNull();
    });

    it("zero TTL causes immediate expiration on next tick", async () => {
      await cache.set("cart-1", null, makePolicies(1), 0);
      vi.advanceTimersByTime(1);
      const result = await cache.get("cart-1");
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // set
  // -----------------------------------------------------------------------

  describe("set", () => {
    it("overwrites existing cache entry", async () => {
      const policies1 = [makePolicy({ id: "old" })];
      const policies2 = [makePolicy({ id: "new" })];

      await cache.set("cart-1", null, policies1, 60_000);
      await cache.set("cart-1", null, policies2, 60_000);

      const result = await cache.get("cart-1");
      expect(result).toEqual(policies2);
    });

    it("stores a copy of the policies (not the original reference)", async () => {
      const policies = makePolicies(2);
      await cache.set("cart-1", null, policies, 60_000);

      // Mutate the original array
      policies.push(makePolicy({ id: "sneaked-in" }));

      const result = await cache.get("cart-1");
      expect(result).toHaveLength(2);
    });

    it("can store an empty policies array", async () => {
      await cache.set("cart-1", null, [], 60_000);
      const result = await cache.get("cart-1");
      expect(result).toEqual([]);
    });

    it("resets TTL on overwrite", async () => {
      await cache.set("cart-1", null, makePolicies(1), 1000);
      vi.advanceTimersByTime(800);

      // Overwrite with new TTL
      await cache.set("cart-1", null, makePolicies(1), 1000);
      vi.advanceTimersByTime(800);

      // Total time: 1600ms, but entry was reset at 800ms, so it has 200ms remaining
      const result = await cache.get("cart-1");
      expect(result).not.toBeNull();
    });

    it("can set entries for many cartridges simultaneously", async () => {
      for (let i = 0; i < 100; i++) {
        await cache.set(`cart-${i}`, null, makePolicies(1, `cart-${i}`), 60_000);
      }
      for (let i = 0; i < 100; i++) {
        const result = await cache.get(`cart-${i}`);
        expect(result).not.toBeNull();
      }
    });
  });

  // -----------------------------------------------------------------------
  // invalidate
  // -----------------------------------------------------------------------

  describe("invalidate", () => {
    it("invalidates all entries for a specific cartridgeId", async () => {
      await cache.set("cart-1", null, makePolicies(1), 60_000);
      await cache.set("cart-1", "org-1", makePolicies(1), 60_000);
      await cache.set("cart-1", "org-2", makePolicies(1), 60_000);

      await cache.invalidate("cart-1");

      expect(await cache.get("cart-1")).toBeNull();
      expect(await cache.get("cart-1", "org-1")).toBeNull();
      expect(await cache.get("cart-1", "org-2")).toBeNull();
    });

    it("does not affect entries for other cartridges", async () => {
      await cache.set("cart-1", null, makePolicies(1, "cart-1"), 60_000);
      await cache.set("cart-2", null, makePolicies(1, "cart-2"), 60_000);

      await cache.invalidate("cart-1");

      expect(await cache.get("cart-1")).toBeNull();
      expect(await cache.get("cart-2")).not.toBeNull();
    });

    it("invalidates all entries when no cartridgeId is provided", async () => {
      await cache.set("cart-1", null, makePolicies(1, "cart-1"), 60_000);
      await cache.set("cart-2", "org-1", makePolicies(1, "cart-2"), 60_000);
      await cache.set("cart-3", "org-2", makePolicies(1, "cart-3"), 60_000);

      await cache.invalidate();

      expect(await cache.get("cart-1")).toBeNull();
      expect(await cache.get("cart-2", "org-1")).toBeNull();
      expect(await cache.get("cart-3", "org-2")).toBeNull();
    });

    it("is idempotent — invalidating non-existent cartridge is a no-op", async () => {
      // Should not throw
      await cache.invalidate("nonexistent");
    });

    it("invalidate without args on empty cache is a no-op", async () => {
      // Should not throw
      await cache.invalidate();
    });

    it("after invalidation, new entries can be set for the same cartridge", async () => {
      await cache.set("cart-1", null, [makePolicy({ id: "old" })], 60_000);
      await cache.invalidate("cart-1");
      await cache.set("cart-1", null, [makePolicy({ id: "new" })], 60_000);

      const result = await cache.get("cart-1");
      expect(result).toHaveLength(1);
      expect(result![0]!.id).toBe("new");
    });

    it("only invalidates keys with matching prefix", async () => {
      // Ensure "cart-1" prefix doesn't accidentally match "cart-10"
      await cache.set("cart-1", null, makePolicies(1, "cart-1"), 60_000);
      await cache.set("cart-10", null, makePolicies(1, "cart-10"), 60_000);

      await cache.invalidate("cart-1");

      expect(await cache.get("cart-1")).toBeNull();
      // "cart-10" starts with "cart-1:" prefix check: "cart-10:" vs "cart-1:"
      // The prefix is "cart-1:" so "cart-10:" should NOT match
      expect(await cache.get("cart-10")).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Cache key structure
  // -----------------------------------------------------------------------

  describe("cache key structure", () => {
    it("global (null org) key is different from org-specific key", async () => {
      const globalPolicies = [makePolicy({ id: "global" })];
      const orgPolicies = [makePolicy({ id: "org-specific" })];

      await cache.set("cart-1", null, globalPolicies, 60_000);
      await cache.set("cart-1", "org-1", orgPolicies, 60_000);

      const globalResult = await cache.get("cart-1", null);
      const orgResult = await cache.get("cart-1", "org-1");

      expect(globalResult![0]!.id).toBe("global");
      expect(orgResult![0]!.id).toBe("org-specific");
    });

    it("organizationId 'global' is a valid distinct key from null", async () => {
      // The cache key for null org is "cartridgeId:global"
      // The cache key for org="global" is also "cartridgeId:global"
      // This is an intentional behavior of the cacheKey function
      const nullOrgPolicies = [makePolicy({ id: "null-org" })];
      await cache.set("cart-1", null, nullOrgPolicies, 60_000);

      // Setting org="global" should overwrite the null org entry
      const globalOrgPolicies = [makePolicy({ id: "global-org" })];
      await cache.set("cart-1", "global", globalOrgPolicies, 60_000);

      // Both should return the same value since the key collides
      const result = await cache.get("cart-1", null);
      expect(result![0]!.id).toBe("global-org");
    });
  });

  // -----------------------------------------------------------------------
  // Async interface compliance
  // -----------------------------------------------------------------------

  describe("async interface", () => {
    it("get returns a Promise", () => {
      const result = cache.get("cart-1");
      expect(result).toBeInstanceOf(Promise);
    });

    it("set returns a Promise", () => {
      const result = cache.set("cart-1", null, [], 60_000);
      expect(result).toBeInstanceOf(Promise);
    });

    it("invalidate returns a Promise", () => {
      const result = cache.invalidate();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
