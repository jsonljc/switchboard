import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES_DIR = resolve(import.meta.dirname, "../routes");

/**
 * Routes that are exempt from the PlatformIngress boundary.
 * - simulate.ts: read-only dry-run, not a work submission
 * - approvals.ts: responds to existing work, not new ingress
 */
const EXEMPT_ROUTES = new Set(["simulate.ts", "approvals.ts"]);

describe("PlatformIngress boundary enforcement", () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("has route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    if (EXEMPT_ROUTES.has(file)) continue;

    it(`${file} does not call orchestrator.resolveAndPropose()`, () => {
      const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
      expect(source).not.toContain("orchestrator.resolveAndPropose");
      expect(source).not.toContain("resolveAndPropose(");
    });
  }
});
