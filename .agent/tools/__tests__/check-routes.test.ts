import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runCheckRoutes } from "../check-routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // .agent/tools/__tests__ -> repo root

describe("runCheckRoutes (CLI integration)", () => {
  it("synthetic violation: reports one ingress finding and exits non-zero", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-violation/**/*.ts")],
      allowlistPath: join(here, "fixtures/empty-allowlist.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("ingress");
    expect(result.findings[0].line).toBeGreaterThan(0);
  });

  it("synthetic clean: no findings, exits zero", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-clean/**/*.ts")],
      allowlistPath: join(here, "fixtures/empty-allowlist.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("allowlist suppresses findings and reports the count", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-violation/**/*.ts")],
      allowlistPath: join(here, "fixtures/violation-allowlisted.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.suppressedCount).toBeGreaterThanOrEqual(1);
  });
});
