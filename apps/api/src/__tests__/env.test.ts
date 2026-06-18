import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { REQUIRED_ENV, SESSION_SECRET_KEYS, assertRequiredEnv } from "../env.js";

// Every env key the gate touches: the unconditional singles plus the either-or session-secret group.
const ALL_KEYS = [...REQUIRED_ENV, ...SESSION_SECRET_KEYS] as const;

describe("assertRequiredEnv", () => {
  let original: Record<string, string | undefined>;
  let exitSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    original = {};
    for (const key of ALL_KEYS) {
      original[key] = process.env[key];
    }
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ALL_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns silently when every REQUIRED_ENV var and a session secret are set", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    process.env["SESSION_TOKEN_SECRET"] = "value";
    delete process.env["NEXTAUTH_SECRET"];
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // The canonical prod path: render.yaml declares SESSION_TOKEN_SECRET, not NEXTAUTH_SECRET.
  it("boots with SESSION_TOKEN_SECRET set and NEXTAUTH_SECRET unset", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    process.env["SESSION_TOKEN_SECRET"] = "render-canonical-secret";
    delete process.env["NEXTAUTH_SECRET"];
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // Back-compat: existing deploys that only set the shared NextAuth secret still boot.
  it("boots with NEXTAUTH_SECRET set and SESSION_TOKEN_SECRET unset", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    process.env["NEXTAUTH_SECRET"] = "legacy-shared-secret";
    delete process.env["SESSION_TOKEN_SECRET"];
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 with an actionable error when NEITHER session secret is set", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    delete process.env["SESSION_TOKEN_SECRET"];
    delete process.env["NEXTAUTH_SECRET"];
    expect(() => assertRequiredEnv()).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsg = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errMsg).toContain("SESSION_TOKEN_SECRET");
    expect(errMsg).toContain("worktree:init");
  });

  for (const key of REQUIRED_ENV) {
    it(`exits 1 with an actionable error mentioning ${key} when ${key} is unset`, () => {
      for (const k of REQUIRED_ENV) process.env[k] = "value";
      process.env["SESSION_TOKEN_SECRET"] = "value";
      delete process.env[key];
      expect(() => assertRequiredEnv()).toThrow("__exit__");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errMsg = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(errMsg).toContain(key);
      expect(errMsg).toContain("worktree:init");
    });
  }
});
