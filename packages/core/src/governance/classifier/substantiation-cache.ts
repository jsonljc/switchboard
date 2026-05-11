import type { ClaimType, SubstantiationResolution } from "@switchboard/schemas";

export interface SubstantiationCacheKey {
  /**
   * sha256(lowercase(sentence)) — short prefix is sufficient.
   * Name reflects what is hashed (the model-output sentence under
   * classification), NOT the operator-authored claimText it might match.
   */
  sentenceHash: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  deploymentId: string;
}

export interface SubstantiationCache {
  get(key: SubstantiationCacheKey): SubstantiationResolution | undefined;
  set(key: SubstantiationCacheKey, value: SubstantiationResolution): void;
}

export interface InMemoryLRUOptions {
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

function serialize(key: SubstantiationCacheKey): string {
  return `${key.deploymentId}|${key.jurisdiction}|${key.claimType}|${key.sentenceHash}`;
}

/**
 * In-memory LRU cache for matched substantiation resolutions. The classifier
 * resolver (Task 14) caches MATCHES ONLY — stale and missing resolutions are
 * never cached, so a new approved_compliance_claim row that would match an
 * unseen sentence does not need invalidation.
 *
 * Multi-tenant safety: deploymentId is included in the serialized key so a
 * match cached for tenant A is never served to tenant B.
 *
 * Bounded memory: default 5000 entries; LRU eviction on overflow.
 *
 * Implementation note: JS Map preserves insertion order. Deleting and
 * re-inserting a key moves it to the most-recently-used position, which is
 * the primitive needed for LRU. Eviction drops the oldest key (first
 * inserted) until the size is back within bounds.
 */
export function createInMemoryLRU(opts: InMemoryLRUOptions = {}): SubstantiationCache {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const store = new Map<string, SubstantiationResolution>();

  return {
    get(key) {
      const k = serialize(key);
      const v = store.get(k);
      if (v !== undefined) {
        // Promote to most-recently-used.
        store.delete(k);
        store.set(k, v);
      }
      return v;
    },
    set(key, value) {
      const k = serialize(key);
      if (store.has(k)) store.delete(k);
      store.set(k, value);
      while (store.size > maxEntries) {
        // Evict the oldest key (first inserted).
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
  };
}
