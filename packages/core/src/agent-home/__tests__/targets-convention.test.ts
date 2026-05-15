// packages/core/src/agent-home/__tests__/targets-convention.test.ts
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["config.avgValueCents", "config.targetCpbCents"];

function rg(pattern: string, scope: string[]): string[] {
  try {
    const out = execSync(
      `git grep -nE ${JSON.stringify(pattern)} -- ${scope.map((s) => `'${s}'`).join(" ")}`,
      { encoding: "utf8", cwd: process.cwd() },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("targets convention — only getAgentTargets reads config keys", () => {
  for (const pattern of FORBIDDEN) {
    it(`forbids direct ${pattern} access outside targets.ts`, () => {
      const matches = rg(pattern.replace(".", "\\."), [
        "packages/core/src/agent-home/metrics-*.ts",
        "apps/api/src/routes/**/*.ts",
        "apps/dashboard/src/lib/cockpit/*.ts",
        "apps/dashboard/src/components/cockpit/*.tsx",
      ]);
      // targets.ts itself and tests / docs are excluded by the scope above.
      expect(matches, matches.join("\n")).toEqual([]);
    });
  }
});
