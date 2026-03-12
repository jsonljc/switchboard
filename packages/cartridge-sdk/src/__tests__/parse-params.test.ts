import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseParams, ParamValidationError } from "../parse-params.js";

const TestSchema = z.object({
  name: z.string(),
  count: z.number(),
  optional: z.string().default("fallback"),
});

describe("parseParams", () => {
  it("parses valid parameters", () => {
    const result = parseParams(TestSchema, { name: "test", count: 42 });
    expect(result).toEqual({ name: "test", count: 42, optional: "fallback" });
  });

  it("applies defaults for missing optional fields", () => {
    const result = parseParams(TestSchema, { name: "test", count: 1 });
    expect(result.optional).toBe("fallback");
  });

  it("uses provided values over defaults", () => {
    const result = parseParams(TestSchema, { name: "test", count: 1, optional: "custom" });
    expect(result.optional).toBe("custom");
  });

  it("throws ParamValidationError for missing required fields", () => {
    expect(() => parseParams(TestSchema, { name: "test" })).toThrow(ParamValidationError);
  });

  it("throws ParamValidationError for wrong types", () => {
    expect(() => parseParams(TestSchema, { name: 123, count: "not a number" })).toThrow(
      ParamValidationError,
    );
  });

  it("includes field paths in error message", () => {
    try {
      parseParams(TestSchema, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamValidationError);
      const error = err as ParamValidationError;
      expect(error.message).toContain("name");
      expect(error.message).toContain("count");
    }
  });

  it("exposes the underlying ZodError", () => {
    try {
      parseParams(TestSchema, {});
      expect.fail("Should have thrown");
    } catch (err) {
      const error = err as ParamValidationError;
      expect(error.zodError).toBeDefined();
      expect(error.zodError.issues.length).toBeGreaterThan(0);
    }
  });

  it("handles empty params object", () => {
    const OptionalSchema = z.object({
      tag: z.string().default("default"),
    });
    const result = parseParams(OptionalSchema, {});
    expect(result).toEqual({ tag: "default" });
  });

  it("strips extra fields not in schema", () => {
    const result = parseParams(TestSchema, {
      name: "test",
      count: 5,
      extra: "should be stripped",
    });
    expect(result).toEqual({ name: "test", count: 5, optional: "fallback" });
    expect((result as Record<string, unknown>)["extra"]).toBeUndefined();
  });
});
