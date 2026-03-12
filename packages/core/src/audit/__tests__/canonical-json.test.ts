import { describe, it, expect } from "vitest";
import { canonicalizeSync } from "../canonical-json.js";

describe("canonicalizeSync", () => {
  describe("primitive values", () => {
    it("serializes null to 'null'", () => {
      expect(canonicalizeSync(null)).toBe("null");
    });

    it("serializes undefined to 'null'", () => {
      expect(canonicalizeSync(undefined)).toBe("null");
    });

    it("serializes boolean true", () => {
      expect(canonicalizeSync(true)).toBe("true");
    });

    it("serializes boolean false", () => {
      expect(canonicalizeSync(false)).toBe("false");
    });

    it("serializes integer numbers", () => {
      expect(canonicalizeSync(42)).toBe("42");
      expect(canonicalizeSync(0)).toBe("0");
      expect(canonicalizeSync(-1)).toBe("-1");
    });

    it("serializes floating-point numbers", () => {
      expect(canonicalizeSync(3.14)).toBe("3.14");
      expect(canonicalizeSync(-0.5)).toBe("-0.5");
    });

    it("serializes strings with proper JSON escaping", () => {
      expect(canonicalizeSync("hello")).toBe('"hello"');
      expect(canonicalizeSync("")).toBe('""');
      expect(canonicalizeSync('with "quotes"')).toBe('"with \\"quotes\\""');
      expect(canonicalizeSync("line\nbreak")).toBe('"line\\nbreak"');
    });
  });

  describe("arrays", () => {
    it("serializes empty array", () => {
      expect(canonicalizeSync([])).toBe("[]");
    });

    it("serializes array of primitives", () => {
      expect(canonicalizeSync([1, 2, 3])).toBe("[1,2,3]");
    });

    it("serializes array with mixed types", () => {
      expect(canonicalizeSync([1, "two", true, null])).toBe('[1,"two",true,null]');
    });

    it("serializes nested arrays", () => {
      expect(canonicalizeSync([[1, 2], [3]])).toBe("[[1,2],[3]]");
    });

    it("serializes array with undefined elements as null", () => {
      // JSON.stringify converts undefined array elements to null
      // but canonicalizeSync maps items, so undefined becomes "null"
      expect(canonicalizeSync([undefined])).toBe("[null]");
    });
  });

  describe("objects", () => {
    it("serializes empty object", () => {
      expect(canonicalizeSync({})).toBe("{}");
    });

    it("serializes object with sorted keys", () => {
      const result = canonicalizeSync({ b: 2, a: 1, c: 3 });
      expect(result).toBe('{"a":1,"b":2,"c":3}');
    });

    it("omits keys with undefined values", () => {
      const result = canonicalizeSync({ a: 1, b: undefined, c: 3 });
      expect(result).toBe('{"a":1,"c":3}');
    });

    it("serializes nested objects with sorted keys at each level", () => {
      const result = canonicalizeSync({
        z: { b: 2, a: 1 },
        a: { d: 4, c: 3 },
      });
      expect(result).toBe('{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
    });

    it("serializes objects containing arrays", () => {
      const result = canonicalizeSync({ items: [1, 2], name: "test" });
      expect(result).toBe('{"items":[1,2],"name":"test"}');
    });
  });

  describe("deterministic output", () => {
    it("produces identical output regardless of key insertion order", () => {
      const obj1 = { z: 1, a: 2, m: 3 };
      const obj2 = { a: 2, m: 3, z: 1 };
      const obj3 = { m: 3, z: 1, a: 2 };

      const result1 = canonicalizeSync(obj1);
      const result2 = canonicalizeSync(obj2);
      const result3 = canonicalizeSync(obj3);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it("produces identical output for deeply nested structures", () => {
      const obj1 = {
        b: { d: [3, 2, 1], c: "hello" },
        a: { f: true, e: null },
      };
      const obj2 = {
        a: { e: null, f: true },
        b: { c: "hello", d: [3, 2, 1] },
      };

      expect(canonicalizeSync(obj1)).toBe(canonicalizeSync(obj2));
    });
  });

  describe("edge cases", () => {
    it("handles non-serializable types by returning 'null'", () => {
      // Functions, symbols, etc. fall through the type checks
      expect(canonicalizeSync(() => {})).toBe("null");
      expect(canonicalizeSync(Symbol("test"))).toBe("null");
    });

    it("handles deeply nested structure", () => {
      const deep = { a: { b: { c: { d: { e: "leaf" } } } } };
      expect(canonicalizeSync(deep)).toBe('{"a":{"b":{"c":{"d":{"e":"leaf"}}}}}');
    });

    it("handles keys with special characters", () => {
      const result = canonicalizeSync({ "key with spaces": 1, "key\nwith\nnewlines": 2 });
      // Keys should be JSON-escaped and sorted
      expect(result).toContain('"key with spaces"');
      expect(result).toContain('"key\\nwith\\nnewlines"');
    });

    it("handles numeric string keys sorted lexicographically", () => {
      const result = canonicalizeSync({ "10": "ten", "2": "two", "1": "one" });
      // Lexicographic sort: "1" < "10" < "2"
      expect(result).toBe('{"1":"one","10":"ten","2":"two"}');
    });
  });
});
