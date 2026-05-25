import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSkillPackContentPresent } from "../eval-preflight.js";

describe("assertSkillPackContentPresent", () => {
  it("resolves when every skill-pack scope has content (real markdown)", async () => {
    await expect(assertSkillPackContentPresent()).resolves.toBeUndefined();
  });

  it("throws a loud, specific error when a skill-pack file is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alex-pack-"));
    writeFileSync(join(dir, "objection-handling.md"), "");
    writeFileSync(join(dir, "qualification-framework.md"), "# Qualification\n\nstub");
    writeFileSync(join(dir, "claim-boundaries.md"), "# Claims\n\nstub");
    await expect(assertSkillPackContentPresent(dir)).rejects.toThrow(
      /objection-handling[\s\S]*WITHOUT the medspa playbook/,
    );
  });
});
