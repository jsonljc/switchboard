import { describe, it, expect } from "vitest";
import { CORPUS, corpusHash } from "../corpus.js";
import { PROFILES_BY_SEAM } from "../agent-profiles.js";
import {
  InjectionCorpusSchema,
  INJECTION_CATEGORIES,
  MALFORMED_CATEGORIES,
  InjectionSeamSchema,
  type InjectionCase,
} from "../schema.js";

const bySeam = (seam: string): InjectionCase[] => CORPUS.filter((c) => c.seam === seam);
const categoriesOf = (cases: InjectionCase[]): Set<string> => new Set(cases.map((c) => c.category));
const MONEY_CATEGORIES = ["set-price", "set-deposit", "set-budget"];

describe("injection corpus", () => {
  it("is schema-valid (validated at module load, asserted here too)", () => {
    expect(InjectionCorpusSchema.safeParse(CORPUS).success).toBe(true);
  });

  it("covers every untrusted seam the audit named", () => {
    for (const seam of InjectionSeamSchema.options) {
      expect(bySeam(seam).length).toBeGreaterThan(0);
    }
  });

  it("covers the full ADV-1 injection taxonomy across the corpus", () => {
    const present = categoriesOf(CORPUS.filter((c) => c.kind === "injection"));
    for (const cat of INJECTION_CATEGORIES) {
      expect(present.has(cat), `missing injection category "${cat}"`).toBe(true);
    }
  });

  it("covers the full ADV-3 malformed taxonomy across the corpus", () => {
    const present = categoriesOf(CORPUS.filter((c) => c.kind === "malformed"));
    for (const cat of MALFORMED_CATEGORIES) {
      expect(present.has(cat), `missing malformed category "${cat}"`).toBe(true);
    }
  });

  it("exercises all five malformed categories on the live Alex inbound seam", () => {
    const present = categoriesOf(bySeam("alex-inbound").filter((c) => c.kind === "malformed"));
    for (const cat of MALFORMED_CATEGORIES) {
      expect(present.has(cat), `Alex inbound missing malformed category "${cat}"`).toBe(true);
    }
  });

  it("includes a reveal-system-prompt attack on the live Alex seam", () => {
    expect(bySeam("alex-inbound").some((c) => c.category === "reveal-system-prompt")).toBe(true);
  });

  it("includes a budget tool-arg attack on Riley with a concrete injected value", () => {
    const budget = bySeam("riley-campaign-name").filter((c) => c.category === "set-budget");
    expect(budget.length).toBeGreaterThan(0);
    for (const c of budget) {
      expect((c.expect?.injectedToolArgValues?.length ?? 0) > 0).toBe(true);
    }
  });

  it("gives every money attack (price/deposit/budget) deterministic teeth", () => {
    const money = CORPUS.filter((c) => MONEY_CATEGORIES.includes(c.category));
    expect(money.length).toBeGreaterThan(0);
    for (const c of money) {
      const hasTeeth =
        (c.expect?.injectedToolArgValues?.length ?? 0) > 0 ||
        (c.expect?.forbiddenResponseSubstrings?.length ?? 0) > 0;
      expect(hasTeeth, `money case "${c.id}" has no grader teeth`).toBe(true);
    }
  });

  it("includes a 10k-code-point emoji flood case", () => {
    const flood = CORPUS.find((c) => c.category === "emoji-flood");
    expect(flood).toBeDefined();
    expect([...flood!.payload].length).toBeGreaterThanOrEqual(10000);
  });

  it("produces a stable 16-hex corpus hash", () => {
    expect(corpusHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(corpusHash()).toBe(corpusHash());
  });

  // Honesty guard: an injection case has NO deterministic teeth iff it carries no
  // tool-arg/substring teeth AND its profile has neither a tool allowlist nor leak
  // canaries. Such cases pass vacuously today. Assert the inert set is EXACTLY the
  // known leak-canary-pending reveal-prompt cases (whose teeth IS the prompt-leak
  // check, which lands with the Riley/Mira live lanes). This fails if a new inert
  // case is added — forcing a conscious decision, never silent dead corpus.
  it("tracks exactly the known leak-canary-pending cases (no silently-dead corpus)", () => {
    const inert = CORPUS.filter((c) => {
      if (c.kind !== "injection") return false;
      const p = PROFILES_BY_SEAM[c.seam];
      const hasArgTeeth = (c.expect?.injectedToolArgValues?.length ?? 0) > 0;
      const hasSubstrTeeth = (c.expect?.forbiddenResponseSubstrings?.length ?? 0) > 0;
      const hasToolTeeth = p.allowedToolIds !== null;
      const hasLeakTeeth = p.promptLeakCanaries.length > 0;
      return !hasArgTeeth && !hasSubstrTeeth && !hasToolTeeth && !hasLeakTeeth;
    })
      .map((c) => c.id)
      .sort();
    expect(inert).toEqual(["mira-reveal-prompt", "riley-reveal-prompt"]);
  });
});
