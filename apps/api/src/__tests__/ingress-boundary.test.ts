import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES_DIR = resolve(import.meta.dirname, "../routes");

/**
 * Orchestrator methods that must not be called from route files.
 * All new work submission must go through PlatformIngress.submit().
 *
 * Existing direct calls are tracked in LEGACY_EXCEPTIONS below and
 * must be migrated during ingress convergence (Phase 2).
 */
const BLOCKED_METHODS = ["resolveAndPropose", "propose(", "executePreApproved"];

/**
 * Legacy exceptions — routes that still call the orchestrator directly
 * because PlatformIngress does not yet own these capabilities.
 *
 * Each entry documents WHAT is called and WHY it is exempt.
 * Remove entries as ingress convergence migrates each capability.
 */
const LEGACY_EXCEPTIONS: Record<
  string,
  {
    methods: string[];
    reason: string;
  }
> = {
  "approvals.ts": {
    methods: ["respondToApproval"],
    reason: "PlatformIngress has no approval lifecycle — migrate in Phase 2",
  },
  "actions.ts": {
    methods: ["executeApproved", "requestUndo"],
    reason: "Post-approval execute and undo have no PlatformIngress equivalent yet",
  },
  "governance.ts": {
    methods: ["propose", "executeApproved"],
    reason: "Emergency halt uses legacy cartridge path — migrate to skill-based halt",
  },
};

const FULLY_EXEMPT = new Set(["simulate.ts"]);

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

  it("legacy exceptions are documented and finite", () => {
    const exceptionCount = Object.keys(LEGACY_EXCEPTIONS).length;
    expect(exceptionCount).toBeLessThanOrEqual(3);
  });
});
