import { describe, it, expect } from "vitest";
import { loadResolverCases } from "./load-cases.js";
import { ResolverCaseSchema } from "./schema.js";
import {
  loadResolverMarkdown,
  extractRouteTargets,
  checkDatasetConsistency,
} from "./resolver-routes.js";
import { isMainPush, SKIP_MESSAGE } from "./eval-preflight.js";

// The real, committed artifacts. This is the BLOCKING gate (runs under evals/vitest.config.ts):
// deterministic, no key, no network - it pins the dataset to what RESOLVER.md documents.
const cases = loadResolverCases();
const targets = extractRouteTargets(loadResolverMarkdown());

// The five routes RESOLVER.md documents via `.agent/skills/<slug>/SKILL.md` load paths.
const DOCUMENTED_TARGETS = [
  "architecture-audit",
  "self-serve-readiness-audit",
  "route-chain-audit",
  "implementation",
  "context-compression",
];

describe("resolver dataset (structural)", () => {
  it("loads the committed 7-case dataset", () => {
    expect(cases.length).toBe(7);
  });

  it("every case parses ResolverCaseSchema", () => {
    for (const c of cases) {
      expect(ResolverCaseSchema.safeParse(c).success).toBe(true);
    }
  });
});

describe("RESOLVER.md route extraction", () => {
  it("extracts exactly the documented skill-path targets", () => {
    expect([...targets].sort()).toEqual([...DOCUMENTED_TARGETS].sort());
  });

  it("returns an empty set for markdown with no skill-load paths", () => {
    expect(extractRouteTargets("# doc\n\nno skill load paths here\n").size).toBe(0);
  });
});

describe("drift guard (deterministic consistency check)", () => {
  it("passes: every expected_skill in the real dataset is a documented target", () => {
    const report = checkDatasetConsistency(cases, targets);
    expect(report.mismatches).toEqual([]);
    // All five documented routes are exercised by at least one case.
    expect(report.uncovered).toEqual([]);
  });

  // TEETH (non-vacuous): a synthetic case pointing at an undocumented slug MUST be
  // flagged. If the checker ever no-ops, this assertion reds - proving the guard bites.
  it("TEETH: flags a synthetic case whose expected_skill is not documented", () => {
    const poisoned = [
      ...cases,
      { input: "some totally novel task", expected_skill: "does-not-exist" },
    ];
    const report = checkDatasetConsistency(poisoned, targets);
    expect(report.mismatches.length).toBe(1);
    expect(report.mismatches[0]).toContain("does-not-exist");
  });

  it("TEETH: an empty target set flags every case", () => {
    const report = checkDatasetConsistency(cases, new Set<string>());
    expect(report.mismatches.length).toBe(cases.length);
  });
});

describe("live-leg preflight (idiom)", () => {
  it("isMainPush is true only for a push to refs/heads/main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
    expect(isMainPush({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" })).toBe(
      false,
    );
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/x" })).toBe(false);
    expect(isMainPush({})).toBe(false);
  });

  it("exposes a skip message naming the missing key", () => {
    expect(SKIP_MESSAGE).toMatch(/ANTHROPIC_API_KEY/);
  });
});
