import { describe, it, expect } from "vitest";
import { applyPatch, describePatch } from "../patching.js";

// ===================================================================
// applyPatch
// ===================================================================

describe("applyPatch", () => {
  describe("basic merging", () => {
    it("merges patchValue over originalParams", () => {
      const result = applyPatch({ a: 1, b: 2 }, { b: 99, c: 3 });
      expect(result).toEqual({ a: 1, b: 99, c: 3 });
    });

    it("preserves original when patch is empty", () => {
      const result = applyPatch({ a: 1, b: 2 }, {});
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("returns only patch keys when original is empty", () => {
      const result = applyPatch({}, { x: 10 });
      expect(result).toEqual({ x: 10 });
    });

    it("returns empty object when both inputs are empty", () => {
      const result = applyPatch({}, {});
      expect(result).toEqual({});
    });
  });

  describe("overriding values", () => {
    it("overrides string values", () => {
      const result = applyPatch({ name: "old" }, { name: "new" });
      expect(result).toEqual({ name: "new" });
    });

    it("overrides number values", () => {
      const result = applyPatch({ amount: 100 }, { amount: 200 });
      expect(result).toEqual({ amount: 200 });
    });

    it("overrides boolean values", () => {
      const result = applyPatch({ active: true }, { active: false });
      expect(result).toEqual({ active: false });
    });

    it("can set a value to null", () => {
      const result = applyPatch({ name: "test" }, { name: null });
      expect(result).toEqual({ name: null });
    });

    it("can set a value to undefined", () => {
      const result = applyPatch({ name: "test" }, { name: undefined });
      expect(result).toEqual({ name: undefined });
    });
  });

  describe("immutability", () => {
    it("does not mutate the original params object", () => {
      const original = { a: 1, b: 2 };
      const originalCopy = { ...original };
      applyPatch(original, { b: 99 });
      expect(original).toEqual(originalCopy);
    });

    it("does not mutate the patch object", () => {
      const patch = { b: 99, c: 3 };
      const patchCopy = { ...patch };
      applyPatch({ a: 1 }, patch);
      expect(patch).toEqual(patchCopy);
    });

    it("returns a new object reference", () => {
      const original = { a: 1 };
      const result = applyPatch(original, {});
      expect(result).not.toBe(original);
    });
  });

  describe("various value types", () => {
    it("handles arrays as parameter values", () => {
      const result = applyPatch({ tags: ["a", "b"] }, { tags: ["c"] });
      expect(result).toEqual({ tags: ["c"] });
    });

    it("handles nested objects as parameter values (shallow merge only)", () => {
      const result = applyPatch({ config: { a: 1, b: 2 } }, { config: { a: 10 } });
      // Shallow merge replaces the entire config object
      expect(result).toEqual({ config: { a: 10 } });
    });

    it("handles mixed value types", () => {
      const result = applyPatch(
        { str: "hello", num: 42, bool: true, arr: [1] },
        { str: "world", num: 0 },
      );
      expect(result).toEqual({ str: "world", num: 0, bool: true, arr: [1] });
    });

    it("handles numeric zero as a patch value", () => {
      const result = applyPatch({ budget: 5000 }, { budget: 0 });
      expect(result).toEqual({ budget: 0 });
    });

    it("handles empty string as a patch value", () => {
      const result = applyPatch({ label: "original" }, { label: "" });
      expect(result).toEqual({ label: "" });
    });
  });

  describe("multiple keys", () => {
    it("patches multiple keys at once", () => {
      const result = applyPatch({ a: 1, b: 2, c: 3 }, { a: 10, b: 20 });
      expect(result).toEqual({ a: 10, b: 20, c: 3 });
    });

    it("adds multiple new keys at once", () => {
      const result = applyPatch({ existing: true }, { x: 1, y: 2, z: 3 });
      expect(result).toEqual({ existing: true, x: 1, y: 2, z: 3 });
    });
  });
});

// ===================================================================
// describePatch
// ===================================================================

describe("describePatch", () => {
  describe("change detection", () => {
    it("identifies changed fields", () => {
      const desc = describePatch({ amount: 500, target: "camp-1" }, { amount: 1000 });
      expect(desc).toContain("Modified");
      expect(desc).toContain("amount");
      expect(desc).toContain("500");
      expect(desc).toContain("1000");
    });

    it("returns no changes when values match", () => {
      const desc = describePatch({ amount: 500 }, { amount: 500 });
      expect(desc).toBe("No changes applied");
    });

    it("shows new keys as changes", () => {
      const desc = describePatch({}, { newField: "value" });
      expect(desc).toContain("Modified");
      expect(desc).toContain("newField");
      expect(desc).toContain("undefined");
      expect(desc).toContain("value");
    });

    it("describes multiple changes", () => {
      const desc = describePatch({ amount: 100, target: "old" }, { amount: 200, target: "new" });
      expect(desc).toContain("Modified");
      expect(desc).toContain("amount");
      expect(desc).toContain("target");
    });
  });

  describe("no changes", () => {
    it("returns no changes for empty patch", () => {
      const desc = describePatch({ a: 1, b: 2 }, {});
      expect(desc).toBe("No changes applied");
    });

    it("returns no changes when both are empty", () => {
      const desc = describePatch({}, {});
      expect(desc).toBe("No changes applied");
    });

    it("returns no changes when all patch values match originals", () => {
      const desc = describePatch({ a: 1, b: "hello" }, { a: 1, b: "hello" });
      expect(desc).toBe("No changes applied");
    });
  });

  describe("value formatting", () => {
    it("formats null values using String()", () => {
      const desc = describePatch({ field: "value" }, { field: null });
      expect(desc).toContain("field");
      expect(desc).toContain("value");
      expect(desc).toContain("null");
    });

    it("formats undefined values using String()", () => {
      const desc = describePatch({ field: "value" }, { field: undefined });
      expect(desc).toContain("field");
      expect(desc).toContain("value");
      expect(desc).toContain("undefined");
    });

    it("formats numeric values", () => {
      const desc = describePatch({ count: 0 }, { count: 42 });
      expect(desc).toContain("0");
      expect(desc).toContain("42");
    });

    it("formats boolean values", () => {
      const desc = describePatch({ active: true }, { active: false });
      expect(desc).toContain("true");
      expect(desc).toContain("false");
    });

    it("formats change from undefined (new field) correctly", () => {
      const desc = describePatch({}, { budget: 5000 });
      expect(desc).toContain("budget");
      expect(desc).toContain("undefined");
      expect(desc).toContain("5000");
    });
  });

  describe("arrow formatting", () => {
    it("uses arrow notation between old and new values", () => {
      const desc = describePatch({ x: 1 }, { x: 2 });
      expect(desc).toContain("x: 1 -> 2");
    });

    it("separates multiple changes with commas", () => {
      const desc = describePatch({ a: 1, b: 2 }, { a: 10, b: 20 });
      expect(desc).toContain("a: 1 -> 10");
      expect(desc).toContain("b: 2 -> 20");
      // Changes should be comma-separated within the Modified prefix
      expect(desc).toMatch(/Modified: .+, .+/);
    });
  });

  describe("edge cases with reference equality", () => {
    it("treats identical objects as different (reference comparison)", () => {
      // describePatch uses !== which compares by reference for objects
      const obj = { nested: true };
      const desc = describePatch({ config: obj }, { config: { nested: true } });
      // These are different references, so !== yields true => reported as change
      expect(desc).toContain("Modified");
    });

    it("treats same reference as no change", () => {
      const obj = { nested: true };
      const desc = describePatch({ config: obj }, { config: obj });
      expect(desc).toBe("No changes applied");
    });
  });

  describe("only changed values are listed", () => {
    it("skips unchanged values in the patch", () => {
      const desc = describePatch(
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 999 }, // a is unchanged, b is changed
      );
      expect(desc).not.toContain("a:");
      expect(desc).toContain("b: 2 -> 999");
    });
  });
});
