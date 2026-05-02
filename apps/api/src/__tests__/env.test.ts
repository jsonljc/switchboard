import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { REQUIRED_ENV, assertRequiredEnv } from "../env.js";

describe("assertRequiredEnv", () => {
  let original: Record<string, string | undefined>;
  let exitSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    original = {};
    for (const key of REQUIRED_ENV) {
      original[key] = process.env[key];
    }
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of REQUIRED_ENV) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns silently when every REQUIRED_ENV var is set", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  for (const key of REQUIRED_ENV) {
    it(`exits 1 with an actionable error mentioning ${key} when ${key} is unset`, () => {
      for (const k of REQUIRED_ENV) process.env[k] = "value";
      delete process.env[key];
      expect(() => assertRequiredEnv()).toThrow("__exit__");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errMsg = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(errMsg).toContain(key);
      expect(errMsg).toContain("worktree:init");
    });
  }
});
