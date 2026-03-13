import { describe, it, expect } from "vitest";
import { computeBindingHash, hashObject, validateBindingHash } from "../binding.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBindingData(
  overrides: Partial<{
    envelopeId: string;
    envelopeVersion: number;
    actionId: string;
    parameters: Record<string, unknown>;
    decisionTraceHash: string;
    contextSnapshotHash: string;
  }> = {},
) {
  return {
    envelopeId: "env-001",
    envelopeVersion: 1,
    actionId: "action-launch-campaign",
    parameters: { budget: 5000, target: "us-west" },
    decisionTraceHash: "abc123",
    contextSnapshotHash: "def456",
    ...overrides,
  };
}

// ===================================================================
// computeBindingHash
// ===================================================================

describe("computeBindingHash", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeBindingHash(makeBindingData());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const data = makeBindingData();
    const hash1 = computeBindingHash(data);
    const hash2 = computeBindingHash(data);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different envelopeId", () => {
    const hash1 = computeBindingHash(makeBindingData({ envelopeId: "env-001" }));
    const hash2 = computeBindingHash(makeBindingData({ envelopeId: "env-002" }));
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different envelopeVersion", () => {
    const hash1 = computeBindingHash(makeBindingData({ envelopeVersion: 1 }));
    const hash2 = computeBindingHash(makeBindingData({ envelopeVersion: 2 }));
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different actionId", () => {
    const hash1 = computeBindingHash(makeBindingData({ actionId: "action-a" }));
    const hash2 = computeBindingHash(makeBindingData({ actionId: "action-b" }));
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different parameters", () => {
    const hash1 = computeBindingHash(makeBindingData({ parameters: { budget: 5000 } }));
    const hash2 = computeBindingHash(makeBindingData({ parameters: { budget: 10000 } }));
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different decisionTraceHash", () => {
    const hash1 = computeBindingHash(makeBindingData({ decisionTraceHash: "trace-a" }));
    const hash2 = computeBindingHash(makeBindingData({ decisionTraceHash: "trace-b" }));
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different contextSnapshotHash", () => {
    const hash1 = computeBindingHash(makeBindingData({ contextSnapshotHash: "ctx-a" }));
    const hash2 = computeBindingHash(makeBindingData({ contextSnapshotHash: "ctx-b" }));
    expect(hash1).not.toBe(hash2);
  });

  it("is not affected by parameter key ordering", () => {
    const hash1 = computeBindingHash(
      makeBindingData({ parameters: { alpha: 1, beta: 2, gamma: 3 } }),
    );
    const hash2 = computeBindingHash(
      makeBindingData({ parameters: { gamma: 3, alpha: 1, beta: 2 } }),
    );
    expect(hash1).toBe(hash2);
  });

  it("handles empty parameters object", () => {
    const hash = computeBindingHash(makeBindingData({ parameters: {} }));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles parameters with nested objects", () => {
    const hash = computeBindingHash(
      makeBindingData({ parameters: { config: { a: 1, b: [2, 3] } } }),
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ===================================================================
// hashObject
// ===================================================================

describe("hashObject", () => {
  it("returns a 64-character hex string for a plain object", () => {
    const hash = hashObject({ key: "value" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const obj = { x: 1, y: "hello" };
    expect(hashObject(obj)).toBe(hashObject(obj));
  });

  it("produces the same hash regardless of key order", () => {
    const hash1 = hashObject({ a: 1, b: 2 });
    const hash2 = hashObject({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different objects", () => {
    const hash1 = hashObject({ a: 1 });
    const hash2 = hashObject({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("handles null input", () => {
    const hash = hashObject(null);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles undefined input", () => {
    const hash = hashObject(undefined);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("null and undefined produce the same hash (both canonicalize to 'null')", () => {
    expect(hashObject(null)).toBe(hashObject(undefined));
  });

  it("handles string input", () => {
    const hash = hashObject("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles number input", () => {
    const hash = hashObject(42);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles boolean input", () => {
    const hash = hashObject(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles array input", () => {
    const hash = hashObject([1, 2, 3]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for arrays with different order", () => {
    const hash1 = hashObject([1, 2, 3]);
    const hash2 = hashObject([3, 2, 1]);
    expect(hash1).not.toBe(hash2);
  });

  it("handles deeply nested objects", () => {
    const hash = hashObject({ a: { b: { c: { d: "deep" } } } });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty object", () => {
    const hash = hashObject({});
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty array", () => {
    const hash = hashObject([]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differentiates between empty object and empty array", () => {
    expect(hashObject({})).not.toBe(hashObject([]));
  });
});

// ===================================================================
// validateBindingHash
// ===================================================================

describe("validateBindingHash", () => {
  it("returns true when stored hash matches current data", () => {
    const data = makeBindingData();
    const storedHash = computeBindingHash(data);
    expect(validateBindingHash(storedHash, data)).toBe(true);
  });

  it("returns false when data has changed (envelopeId)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ envelopeId: "tampered-id" });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when data has changed (parameters)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ parameters: { budget: 999999 } });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when data has changed (actionId)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ actionId: "different-action" });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when data has changed (envelopeVersion)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ envelopeVersion: 99 });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when data has changed (decisionTraceHash)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ decisionTraceHash: "new-trace" });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when data has changed (contextSnapshotHash)", () => {
    const original = makeBindingData();
    const storedHash = computeBindingHash(original);
    const tampered = makeBindingData({ contextSnapshotHash: "new-ctx" });
    expect(validateBindingHash(storedHash, tampered)).toBe(false);
  });

  it("returns false when stored hash has different length", () => {
    const data = makeBindingData();
    // A hash with a different length should fail the length check before timingSafeEqual
    expect(validateBindingHash("short", data)).toBe(false);
  });

  it("returns false when stored hash is empty", () => {
    const data = makeBindingData();
    expect(validateBindingHash("", data)).toBe(false);
  });

  it("returns false for a stored hash that is same length but wrong content", () => {
    const data = makeBindingData();
    // Create a 64-char hex string that differs from the actual hash
    const wrongHash = "a".repeat(64);
    const actualHash = computeBindingHash(data);
    // Only run if they differ (they should, but guard against unlikely collision)
    if (wrongHash !== actualHash) {
      expect(validateBindingHash(wrongHash, data)).toBe(false);
    }
  });

  it("validates correctly with empty parameters", () => {
    const data = makeBindingData({ parameters: {} });
    const storedHash = computeBindingHash(data);
    expect(validateBindingHash(storedHash, data)).toBe(true);
  });

  it("validates correctly with complex nested parameters", () => {
    const data = makeBindingData({
      parameters: {
        config: { nested: { deep: true } },
        tags: ["a", "b"],
        count: 42,
      },
    });
    const storedHash = computeBindingHash(data);
    expect(validateBindingHash(storedHash, data)).toBe(true);
  });

  it("is not susceptible to key reordering in parameters", () => {
    const data1 = makeBindingData({ parameters: { a: 1, b: 2 } });
    const storedHash = computeBindingHash(data1);
    const data2 = makeBindingData({ parameters: { b: 2, a: 1 } });
    expect(validateBindingHash(storedHash, data2)).toBe(true);
  });
});
