import { describe, it, expect } from "vitest";
import { createInMemoryLRU, type SubstantiationCacheKey } from "../substantiation-cache.js";

const KEY: SubstantiationCacheKey = {
  sentenceHash: "abc123",
  jurisdiction: "SG",
  claimType: "efficacy",
  deploymentId: "dep_1",
};

const VALUE = {
  status: "matched" as const,
  sourceType: "approved_compliance_claim" as const,
  sourceId: "clm_1",
  matchedText: "visible slimming",
};

describe("InMemoryLRU SubstantiationCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = createInMemoryLRU();
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("round-trips a matched resolution", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get(KEY)).toEqual(VALUE);
  });

  it("isolates by deploymentId (multi-tenant safety)", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get({ ...KEY, deploymentId: "dep_2" })).toBeUndefined();
  });

  it("isolates by jurisdiction and claimType", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get({ ...KEY, jurisdiction: "MY" })).toBeUndefined();
    expect(cache.get({ ...KEY, claimType: "safety-claim" })).toBeUndefined();
  });

  it("evicts least-recently-used entries past maxEntries", () => {
    const cache = createInMemoryLRU({ maxEntries: 2 });
    const k1: SubstantiationCacheKey = { ...KEY, sentenceHash: "h1" };
    const k2: SubstantiationCacheKey = { ...KEY, sentenceHash: "h2" };
    const k3: SubstantiationCacheKey = { ...KEY, sentenceHash: "h3" };

    cache.set(k1, VALUE);
    cache.set(k2, VALUE);
    expect(cache.get(k1)).toEqual(VALUE); // k1 is now most-recently-used
    cache.set(k3, VALUE); // evicts k2 (LRU)

    expect(cache.get(k1)).toEqual(VALUE);
    expect(cache.get(k2)).toBeUndefined();
    expect(cache.get(k3)).toEqual(VALUE);
  });
});
