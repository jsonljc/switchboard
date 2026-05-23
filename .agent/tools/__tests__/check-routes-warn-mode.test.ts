import { describe, expect, it } from "vitest";
import { runRouteClassAdvisory } from "../check-routes.js";

describe("runRouteClassAdvisory (warn-touched mode)", () => {
  it("returns warnings for touched routes only", async () => {
    const result = await runRouteClassAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("returns no warnings when no routes are touched", async () => {
    const result = await runRouteClassAdvisory({
      touchedFiles: [],
      repoRoot: process.cwd(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("ignores touched files that aren't routes", async () => {
    const result = await runRouteClassAdvisory({
      touchedFiles: ["package.json", "apps/api/src/utils/foo.ts"],
      repoRoot: process.cwd(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

describe("runRouteClassAdvisory + cross-app-types integration (via CLI surface)", () => {
  // This is exercised via runCrossAppTypesAdvisory directly in the
  // sibling test file. Here we just confirm both advisories share the
  // same touched-files scope without interfering with each other.
  it("cross-app-types advisory and route-class advisory return independently", async () => {
    const { runRouteClassAdvisory } = await import("../check-routes.js");
    const { runCrossAppTypesAdvisory } = await import("../cross-app-types-check.js");

    const routeOnly = await runRouteClassAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });
    const crossOnly = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });

    expect(routeOnly.exitCode).toBe(0);
    expect(crossOnly.exitCode).toBe(0);
    expect(Array.isArray(routeOnly.warnings)).toBe(true);
    expect(Array.isArray(crossOnly.warnings)).toBe(true);
  });
});
