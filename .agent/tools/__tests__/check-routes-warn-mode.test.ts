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
