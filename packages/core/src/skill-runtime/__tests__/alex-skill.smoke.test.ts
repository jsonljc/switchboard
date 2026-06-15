import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSkill } from "../skill-loader.js";

const SKILLS_DIR = resolve(import.meta.dirname, "../../../../../skills");

describe("Alex skill (real, not fixture)", () => {
  it("loads from directory layout", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.slug).toBe("alex");
  });

  it("discovers reference files with valid metadata", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.references).toBeDefined();
    // 8 reference files today (4 conversation-patterns + 3 medspa + whatsapp-window);
    // a floor guards against a future change silently dropping the live set.
    expect(skill.references!.length).toBeGreaterThanOrEqual(7);

    // Every reference must have populated metadata
    for (const ref of skill.references!) {
      expect(ref.metadata.owner.length).toBeGreaterThan(0);
      expect(ref.metadata.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns reference paths in deterministic POSIX-style order", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const paths = skill.references!.map((r) => r.path);
    // POSIX-style: no backslashes regardless of host OS
    for (const p of paths) {
      expect(p).not.toContain("\\");
    }
    // Deterministic: sorted
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("loads the live medspa skill-pack references", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const paths = skill.references!.map((r) => r.path);
    expect(paths).toContain("references/medspa/objection-handling.md");
    expect(paths).toContain("references/medspa/qualification-framework.md");
    expect(paths).toContain("references/medspa/claim-boundaries.md");
  });

  it("does not ship dead per-market reference files (F6)", () => {
    // F6: the SG/MY market voice files and the SG/MY regulatory rule files were
    // loaded into SkillDefinition.references but never consumed by Alex (only the
    // medspa/ pack reaches the prompt, via the seed path). They were deleted to
    // stop implying per-jurisdiction capability that does not exist. Runtime
    // compliance enforcement is unchanged: it lives in TS (governance/banned-phrases
    // and the claim classifier), not in these markdown files.
    const skill = loadSkill("alex", SKILLS_DIR);
    const paths = skill.references!.map((r) => r.path);
    for (const p of paths) {
      expect(p).not.toMatch(/^references\/markets\//);
      expect(p).not.toMatch(/^references\/regulatory\//);
    }
  });
});
