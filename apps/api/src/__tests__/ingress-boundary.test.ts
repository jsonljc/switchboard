import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES_DIR = resolve(import.meta.dirname, "../routes");

/**
 * Orchestrator methods that must not be called from route files.
 * All work submission and lifecycle operations go through PlatformIngress + PlatformLifecycle.
 *
 * Phase 2 migrated: respondToApproval, executeApproved, requestUndo, propose, emergency halt.
 * simulate route deleted — no legacy bridges remain.
 */
const BLOCKED_METHODS = [
  "resolveAndPropose",
  "propose(",
  "executePreApproved",
  "respondToApproval",
  "executeApproved",
  "requestUndo",
];

/**
 * Legacy exceptions — routes that still call the orchestrator directly.
 * Phase 2 cleared all lifecycle exceptions. No exceptions remain.
 */
const LEGACY_EXCEPTIONS: Record<
  string,
  {
    methods: string[];
    reason: string;
  }
> = {};

const FULLY_EXEMPT = new Set<string>();

describe("PlatformIngress boundary enforcement", () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("has route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    if (FULLY_EXEMPT.has(file)) continue;

    const exception = LEGACY_EXCEPTIONS[file];

    it(`${file} does not call blocked orchestrator methods`, () => {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      for (const method of BLOCKED_METHODS) {
        if (exception?.methods.some((m) => method.includes(m))) continue;
        expect(source).not.toContain(`orchestrator.${method}`);
      }
    });
  }

  it("does not introduce new direct bus.emit() calls in routes", () => {
    for (const file of routeFiles) {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      expect(source).not.toContain("conversionBus.emit(");
    }
  });

  it("does not import route-level deployment resolution helpers in mutating routes", () => {
    for (const file of routeFiles) {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      expect(source).not.toContain("resolveDeploymentForIntent(");
    }
  });

  it("has no legacy exceptions after Phase 2 migration", () => {
    const exceptionCount = Object.keys(LEGACY_EXCEPTIONS).length;
    expect(exceptionCount).toBe(0);
  });

  it("does not accept pre-resolved deployment objects in ingress route source", () => {
    const source = readFileSync(resolve(ROUTES_DIR, "ingress.ts"), "utf-8");
    expect(source).not.toContain("deployment?: Record<string, unknown>");
    expect(source).not.toContain("deployment: body.deployment");
  });
});
