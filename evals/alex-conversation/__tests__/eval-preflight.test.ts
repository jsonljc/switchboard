import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSkillPackContentPresent } from "../eval-preflight.js";

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assertSkillPackContentPresent", () => {
  it("resolves when every skill-pack scope has content (real markdown)", async () => {
    await expect(assertSkillPackContentPresent()).resolves.toBeUndefined();
  });

  it("throws a loud, specific error when a skill-pack file is empty", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "alex-pack-"));
    writeFileSync(join(tempDir, "objection-handling.md"), "");
    writeFileSync(join(tempDir, "qualification-framework.md"), "# Qualification\n\nstub");
    writeFileSync(join(tempDir, "claim-boundaries.md"), "# Claims\n\nstub");
    await expect(assertSkillPackContentPresent(tempDir)).rejects.toThrow(
      /objection-handling[\s\S]*WITHOUT the medspa playbook/,
    );
  });

  it("throws when a skill-pack file has only frontmatter (empty body)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "alex-pack-"));
    writeFileSync(join(tempDir, "objection-handling.md"), "---\ntitle: Objections\n---\n   \n");
    writeFileSync(join(tempDir, "qualification-framework.md"), "# Qualification\n\nstub");
    writeFileSync(join(tempDir, "claim-boundaries.md"), "# Claims\n\nstub");
    await expect(assertSkillPackContentPresent(tempDir)).rejects.toThrow(
      /objection-handling[\s\S]*WITHOUT the medspa playbook/,
    );
  });
});
