import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/check-prisma-drift.sh";
const REAL_SCHEMA = "packages/db/prisma/schema.prisma";
const REAL_MIGRATIONS = "packages/db/prisma/migrations";

describe("check-prisma-drift", () => {
  it("exits 0 when schema matches migrations", () => {
    const result = spawnSync("bash", [SCRIPT], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    expect(result.status).toBe(0);
  }, 30_000);

  it("exits 2 with 'drift detected' message when schema has an unmigrated model", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "drift-test-"));
    const driftedSchemaPath = join(tmpDir, "schema.prisma");
    const real = readFileSync(REAL_SCHEMA, "utf-8");
    writeFileSync(
      driftedSchemaPath,
      `${real}\n\nmodel TestDriftSentinel {\n  id String @id\n}\n`,
    );

    const result = spawnSync(
      "bash",
      [SCRIPT, driftedSchemaPath, REAL_MIGRATIONS],
      { encoding: "utf-8", cwd: process.cwd() },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("drift detected");
  }, 30_000);
});
