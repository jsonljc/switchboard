import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSkill } from "../skill-loader.js";

const SKILLS_DIR = resolve(import.meta.dirname, "../../../../../skills");

describe("Alex skill (real, not fixture)", () => {
  it("loads from directory layout", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.slug).toBe("alex");
  });

  it("discovers all reference files with valid metadata", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.references).toBeDefined();
    expect(skill.references!.length).toBeGreaterThanOrEqual(10);

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

  it("includes critical regulatory references with sources", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const critical = skill.references!.filter((r) => r.metadata.riskLevel === "critical");
    expect(critical.length).toBeGreaterThan(0);
    for (const ref of critical) {
      expect(ref.metadata.sources).toBeDefined();
      expect(ref.metadata.sources!.length).toBeGreaterThan(0);
    }
  });
});
