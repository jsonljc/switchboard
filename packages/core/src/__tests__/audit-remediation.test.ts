import { describe, it, expect } from "vitest";
import { canonicalizeSync } from "../audit/canonical-json.js";
import { hashObject } from "../approval/binding.js";
import { storeEvidence, verifyEvidence } from "../audit/evidence.js";
import { FileSystemEvidenceStore } from "../audit/evidence.js";
import * as path from "node:path";
import * as os from "node:os";

describe("canonicalizeSync", () => {
  it("should sort object keys deterministically", () => {
    const a = canonicalizeSync({ b: 1, a: 2 });
    const b = canonicalizeSync({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it("should handle nested objects with sorted keys", () => {
    const result = canonicalizeSync({ z: { b: 1, a: 2 }, a: 3 });
    expect(result).toBe('{"a":3,"z":{"a":2,"b":1}}');
  });

  it("should handle arrays preserving order", () => {
    const result = canonicalizeSync([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("should handle arrays of objects", () => {
    const result = canonicalizeSync([{ b: 1, a: 2 }]);
    expect(result).toBe('[{"a":2,"b":1}]');
  });

  it("should filter out undefined values", () => {
    const result = canonicalizeSync({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it("should handle null", () => {
    expect(canonicalizeSync(null)).toBe("null");
  });

  it("should handle primitives", () => {
    expect(canonicalizeSync(42)).toBe("42");
    expect(canonicalizeSync(true)).toBe("true");
    expect(canonicalizeSync("hello")).toBe('"hello"');
  });
});

describe("hashObject determinism", () => {
  it("should produce same hash regardless of key order", () => {
    const hash1 = hashObject({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const hash2 = hashObject({ a: 2, c: { y: 2, z: 1 }, b: 1 });
    expect(hash1).toBe(hash2);
  });
});

describe("storeEvidence / verifyEvidence determinism", () => {
  it("should verify evidence regardless of key order", () => {
    const evidence1 = storeEvidence({ b: 1, a: 2 });
    const verified = verifyEvidence({ a: 2, b: 1 }, evidence1.hash);
    expect(verified).toBe(true);
  });
});

describe("FileSystemEvidenceStore path traversal", () => {
  it("should reject path traversal attempts", async () => {
    const tmpDir = path.join(os.tmpdir(), "evidence-test-" + Date.now());
    const store = new FileSystemEvidenceStore(tmpDir);

    await expect(store.store("../../etc/passwd", Buffer.from("data")))
      .rejects.toThrow("Path traversal detected");

    await expect(store.retrieve("../../../etc/shadow"))
      .rejects.toThrow("Path traversal detected");
  });

  it("should allow safe nested paths", async () => {
    const tmpDir = path.join(os.tmpdir(), "evidence-test-" + Date.now());
    const store = new FileSystemEvidenceStore(tmpDir);

    // This should not throw
    const result = await store.store("subdir/evidence.json", Buffer.from("test"));
    expect(result).toContain(tmpDir);
  });
});
