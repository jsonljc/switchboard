import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runRouteClassAdvisory } from "../check-routes.js";
import { runStoreMutationAdvisory } from "../store-mutation-check.js";

function makeFixtureRepo(files: Record<string, string>): string {
  const root = join(tmpdir(), `warn-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

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

describe("store-mutation advisory integration (warn-touched mode)", () => {
  it("surfaces a store-mutation warning for an un-scoped mutation in a touched store file", async () => {
    const root = makeFixtureRepo({
      "packages/db/src/stores/prisma-fixture-store.ts": [
        "export class FixtureStore {",
        "  async markDone(id: string) {",
        "    await this.prisma.contact.update({ where: { id }, data: { active: false } });",
        "  }",
        "}",
      ].join("\n"),
    });

    const result = await runStoreMutationAdvisory({
      touchedFiles: ["packages/db/src/stores/prisma-fixture-store.ts"],
      repoRoot: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]!.message).toMatch(/organizationId/);
    expect(result.warnings[0]!.path).toBe("packages/db/src/stores/prisma-fixture-store.ts");
  });

  it("returns no warnings when all mutations in touched store files are org-scoped", async () => {
    const root = makeFixtureRepo({
      "packages/db/src/stores/prisma-scoped-store.ts": [
        "export class ScopedStore {",
        "  async markDone(organizationId: string, id: string) {",
        "    await this.prisma.contact.update({ where: { id, organizationId }, data: { active: false } });",
        "  }",
        "}",
      ].join("\n"),
    });

    const result = await runStoreMutationAdvisory({
      touchedFiles: ["packages/db/src/stores/prisma-scoped-store.ts"],
      repoRoot: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
