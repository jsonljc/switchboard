import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composePackBody } from "../pack-composer.js";
import { SkillValidationError } from "../types.js";

let packDir: string;

beforeAll(() => {
  packDir = mkdtempSync(join(tmpdir(), "pack-composer-"));
  // Trailing newline on purpose: this is what prettier enforces on *.md, so the
  // strip-one-newline behavior is what keeps the inline splice byte-identical.
  writeFileSync(join(packDir, "safety-escalation.md"), "## Safety\n\nEscalate on X.\n");
});
afterAll(() => rmSync(packDir, { recursive: true, force: true }));

describe("composePackBody", () => {
  it("returns the body unchanged when there are no pack markers", () => {
    const body = "# Skill\n\nNo markers here.\n";
    expect(composePackBody(body, packDir)).toBe(body);
    expect(composePackBody(body, undefined)).toBe(body);
  });

  it("splices the pack file into the marker, stripping one trailing newline", () => {
    const body = "before\n\n<!-- @pack:safety-escalation -->\n\nafter";
    expect(composePackBody(body, packDir)).toBe("before\n\n## Safety\n\nEscalate on X.\n\nafter");
  });

  it("throws when a marker is present but packDir is undefined (orphan marker, fail-closed)", () => {
    const body = "x\n<!-- @pack:safety-escalation -->\ny";
    expect(() => composePackBody(body, undefined)).toThrow(SkillValidationError);
  });

  it("throws naming the slot when a marker is present but the pack file is missing", () => {
    const body = "x\n<!-- @pack:does-not-exist -->\ny";
    expect(() => composePackBody(body, packDir)).toThrow(/does-not-exist/);
  });

  it("throws (fail-closed) on a malformed non-kebab slot instead of leaking the marker verbatim", () => {
    for (const slot of ["Safety", "safety_escalation", "2fa"]) {
      const body = `x\n<!-- @pack:${slot} -->\ny`;
      expect(() => composePackBody(body, packDir)).toThrow(SkillValidationError);
    }
  });

  it("throws (fail-closed) when the pack file exists but is empty/whitespace", () => {
    writeFileSync(join(packDir, "empty-block.md"), "\n");
    const body = "x\n<!-- @pack:empty-block -->\ny";
    expect(() => composePackBody(body, packDir)).toThrow(/empty/i);
  });
});
