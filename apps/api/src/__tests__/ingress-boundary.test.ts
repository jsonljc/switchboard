import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROUTES_DIR = resolve(import.meta.dirname, "../routes");

/**
 * Orchestrator methods that must not be called from route files.
 * All work submission and lifecycle operations go through PlatformIngress + PlatformLifecycle.
 *
 * Phase 2 migrated: respondToApproval, executeApproved, requestUndo, propose, emergency halt.
 * Remaining legacy bridge: simulate (read-only, no lifecycle mutation — requires cartridge
 * integration not yet available in GovernanceGate simulation mode).
 */
const BLOCKED_METHODS = [
  "resolveAndPropose",
  "propose(",
  "executePreApproved",
  "respondToApproval",
  "executeApproved",
  "requestUndo",
  "routingConfig",
];

/**
 * Legacy exceptions — routes that still call the orchestrator directly.
 * Phase 2 cleared all lifecycle exceptions. Only simulate remains.
 */
const LEGACY_EXCEPTIONS: Record<
  string,
  {
    methods: string[];
    reason: string;
  }
> = {};

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

  it("has no legacy exceptions after Phase 2 migration", () => {
    const exceptionCount = Object.keys(LEGACY_EXCEPTIONS).length;
    expect(exceptionCount).toBe(0);
  });

  it("does not import ApprovalManager in any route file", () => {
    for (const file of routeFiles) {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      expect(source).not.toContain("ApprovalManager");
    }
  });

  it("ApprovalManager source file does not exist", () => {
    const approvalManagerPath = resolve(
      import.meta.dirname,
      "../../../../packages/core/src/orchestrator/approval-manager.ts",
    );
    expect(existsSync(approvalManagerPath)).toBe(false);
  });

  it("no core package source file references deleted ApprovalManager", () => {
    const roots = [resolve(import.meta.dirname, "../../../../packages/core/src")];
    // ApprovalManager was deleted — block imports and class references
    const banned = ["ApprovalManager"];
    const violations: string[] = [];

    function scanDir(dir: string): void {
      try {
        const dirEntries = readdirSync(dir, { withFileTypes: true });
        for (const d of dirEntries) {
          const fullPath = join(dir, d.name);
          if (d.isDirectory() && d.name !== "node_modules" && d.name !== ".turbo") {
            scanDir(fullPath);
          } else if (
            d.isFile() &&
            fullPath.endsWith(".ts") &&
            !fullPath.includes("__tests__") &&
            !fullPath.endsWith(".test.ts") &&
            !fullPath.endsWith(".d.ts")
          ) {
            const source = readFileSync(fullPath, "utf-8");
            for (const pattern of banned) {
              if (source.includes(pattern)) {
                violations.push(`${fullPath} contains "${pattern}"`);
              }
            }
          }
        }
      } catch {
        return;
      }
    }

    for (const root of roots) {
      scanDir(root);
    }

    expect(violations).toEqual([]);
  });
});
