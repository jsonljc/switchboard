import { describe, it, expect, beforeEach } from "vitest";
import { loadRewriteTemplates } from "../loader.js";
import { _resetRewriteTemplateCache } from "../loader.js";

const REWRITEABLE = ["efficacy", "safety-claim", "superiority", "urgency"] as const;

describe("loadRewriteTemplates", () => {
  beforeEach(() => {
    _resetRewriteTemplateCache();
  });

  for (const j of ["SG", "MY"] as const) {
    it(`returns one template per rewriteable claim type for ${j}`, () => {
      const templates = loadRewriteTemplates(j);
      for (const ct of REWRITEABLE) {
        const match = templates.find((t) => t.claimType === ct);
        expect(match, `${j} ${ct} template missing`).toBeDefined();
        expect(match!.template.trim().length).toBeGreaterThan(20);
      }
    });
  }

  it("freezes the returned array", () => {
    expect(Object.isFrozen(loadRewriteTemplates("SG"))).toBe(true);
  });

  it("returns the same instance across calls (memoization)", () => {
    expect(loadRewriteTemplates("SG")).toBe(loadRewriteTemplates("SG"));
  });

  it("guarantees unique ids per jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const ids = new Set<string>();
      for (const t of loadRewriteTemplates(j)) {
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      }
    }
  });
});
