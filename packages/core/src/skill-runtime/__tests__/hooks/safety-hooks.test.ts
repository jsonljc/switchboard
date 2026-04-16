import { describe, it, expect } from "vitest";
import { CircuitBreakerHook } from "../../hooks/circuit-breaker-hook.js";
import { BlastRadiusHook } from "../../hooks/blast-radius-hook.js";
import type { SkillHookContext } from "../../types.js";
import type { CircuitBreaker } from "../../circuit-breaker.js";
import type { BlastRadiusLimiter } from "../../blast-radius-limiter.js";

describe("CircuitBreakerHook", () => {
  const createContext = (): SkillHookContext => ({
    deploymentId: "test-deployment",
    orgId: "test-org",
    sessionId: "test-session",
    skillSlug: "test-skill",
    skillVersion: "1.0.0",
    trustLevel: "guided",
    trustScore: 50,
  });

  it("proceeds when circuit breaker allows", async () => {
    const mockCircuitBreaker = {
      check: async () => ({ allowed: true }),
    } as unknown as CircuitBreaker;

    const hook = new CircuitBreakerHook(mockCircuitBreaker);
    const result = await hook.beforeSkill(createContext());

    expect(result.proceed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks when circuit breaker denies", async () => {
    const mockCircuitBreaker = {
      check: async () => ({
        allowed: false,
        reason: "Circuit open: too many recent failures",
      }),
    } as unknown as CircuitBreaker;

    const hook = new CircuitBreakerHook(mockCircuitBreaker);
    const result = await hook.beforeSkill(createContext());

    expect(result.proceed).toBe(false);
    expect(result.reason).toBe("Circuit open: too many recent failures");
  });
});

describe("BlastRadiusHook", () => {
  const createContext = (): SkillHookContext => ({
    deploymentId: "test-deployment",
    orgId: "test-org",
    sessionId: "test-session",
    skillSlug: "test-skill",
    skillVersion: "1.0.0",
    trustLevel: "guided",
    trustScore: 50,
  });

  it("proceeds when blast radius limiter allows", async () => {
    const mockLimiter = {
      check: async () => ({ allowed: true }),
    } as unknown as BlastRadiusLimiter;

    const hook = new BlastRadiusHook(mockLimiter);
    const result = await hook.beforeSkill(createContext());

    expect(result.proceed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks when blast radius limiter denies", async () => {
    const mockLimiter = {
      check: async () => ({
        allowed: false,
        reason: "Concurrent execution limit reached (max 5)",
      }),
    } as unknown as BlastRadiusLimiter;

    const hook = new BlastRadiusHook(mockLimiter);
    const result = await hook.beforeSkill(createContext());

    expect(result.proceed).toBe(false);
    expect(result.reason).toBe("Concurrent execution limit reached (max 5)");
  });
});
