import { describe, it, expect } from "vitest";
import {
  evaluateClaimSafety,
  deriveClaimsPolicyTag,
  parseClaimsPolicyTag,
  CLAIM_SAFETY_RULES,
  type ClaimViolationCategory,
} from "../ugc/claim-safety.js";

// EV-13 / MONEY-7. The deterministic, no-key claim-safety detector over generated
// UGC scripts. Grounded in skills/alex/references/medspa/claim-boundaries.md. This
// is the safety-critical leg: a medspa script that promises a guaranteed result,
// asserts personal safety, claims FDA approval, diagnoses, or fabricates an offer
// must be flagged so it never reaches paid production unreviewed.

describe("evaluateClaimSafety - clean scripts pass", () => {
  it("passes a compliant UGC script that explains generally and routes to a consult", () => {
    const text =
      "Hey so honestly I've been curious about these injectable treatments for a while. " +
      "I booked a consultation and the doctor walked me through what it actually does and " +
      "whether it even made sense for me. No pressure at all - I just liked that they take " +
      "the time to explain things. If you're curious too, book a consult and ask them.";
    const result = evaluateClaimSafety({ text });
    expect(result.verdict).toBe("clean");
    expect(result.violations).toHaveLength(0);
  });

  it("does not flag ordinary words that merely contain a banned token as a substring", () => {
    // "bestseller" must not trip the superiority \bbest\b rule; "secure" must not
    // trip "cure"; "permanently" is a real violation (see below) but "perm" alone
    // in "performance" must not trip "permanent".
    const text =
      "This little routine has honestly been my bestseller-level favorite. I feel secure " +
      "about my performance at work now and that's it, no big promises.";
    const result = evaluateClaimSafety({ text });
    expect(result.verdict).toBe("clean");
  });
});

describe("evaluateClaimSafety - banned medical claims are flagged", () => {
  it("flags a guaranteed-results / efficacy claim (claim-boundaries: never guarantee results)", () => {
    const result = evaluateClaimSafety({
      text: "Trust me, you will see guaranteed results and it will permanently fix your skin.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("efficacy");
  });

  it("flags an FDA-approved regulatory claim (task: 'FDA-approved')", () => {
    const result = evaluateClaimSafety({
      text: "This is the only FDA-approved device that erases wrinkles for good.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("credentials");
  });

  it("flags a 100% / cure claim", () => {
    const result = evaluateClaimSafety({
      text: "It's 100% effective and basically cures acne overnight.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("efficacy");
  });

  it("flags a personal-safety claim (claim-boundaries: never assert 'safe for you' / no side effects)", () => {
    const result = evaluateClaimSafety({
      text: "Don't worry, it's completely safe for you and you won't have any side effects.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("safety-claim");
  });

  it("flags a superiority claim (claim-boundaries: no superiority claims without evidence)", () => {
    const result = evaluateClaimSafety({
      text: "We're the best clinic in town and our results are far better than anyone else's.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("superiority");
  });

  it("flags an urgency / scarcity tactic (claim-boundaries: no urgency tactics)", () => {
    const result = evaluateClaimSafety({
      text: "Only a few slots left this week, so act now before this price ends soon!",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("urgency");
  });

  it("flags a testimonial / before-after anecdote (claim-boundaries: no testimonials)", () => {
    const result = evaluateClaimSafety({
      text: "My other clients saw amazing before and after transformations, real results.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("testimonial");
  });

  it("flags an explicit diagnosis (claim-boundaries: never diagnose)", () => {
    const result = evaluateClaimSafety({
      text: "From your photo I can diagnose that you have melasma, so you need this.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("diagnosis");
  });
});

describe("evaluateClaimSafety - hallucinated offers + forbidden phrases", () => {
  it("flags a hallucinated discount offer (no operator-grounded offer copy exists here)", () => {
    const result = evaluateClaimSafety({
      text: "Get 50% off your first session - money-back guarantee if you don't love it!",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("hallucinated-offer");
  });

  it("flags a creator/brand forbidden phrase passed in by the caller", () => {
    const result = evaluateClaimSafety({
      text: "Honestly this stuff is bomb, you have to try it.",
      forbiddenPhrases: ["this stuff is bomb"],
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("forbidden-phrase");
  });

  it("flags the UGC global forbidden ad-copy phrases", () => {
    const result = evaluateClaimSafety({
      text: "Limited time offer, don't miss out, click the link below now.",
    });
    expect(result.verdict).toBe("flagged");
    expect(result.violations.map((v) => v.category)).toContain("forbidden-phrase");
  });

  it("returns the matched text for each violation so an operator can see what tripped", () => {
    const result = evaluateClaimSafety({
      text: "You will see guaranteed results, permanently.",
    });
    expect(result.verdict).toBe("flagged");
    for (const v of result.violations) {
      expect(v.matchedText.length).toBeGreaterThan(0);
      expect(v.rule.length).toBeGreaterThan(0);
    }
  });
});

// ── Review-finding hardening (EV-13 follow-up) ───────────────────────────────
// Each block below pins a fix from the PR review: a dead rule, the superiority
// words claim-boundaries.md explicitly lists, and the paraphrase/synonym residual
// the lexical block-time gate was missing. The benign corpus proves the additions
// add coverage WITHOUT new false positives (this is a regulated-vertical gate).

describe("evaluateClaimSafety - hardening: the $NN-off rule was dead (leading \\b bug)", () => {
  it("now catches a dollar-prefixed offer ('$NN off') that previously slipped clean", () => {
    // "$" is a non-word char, so a leading \b before a group starting with "$"
    // never matched a space/start-prefixed "$50 off" -> it reached paid production.
    for (const text of ["Get $50 off your first visit.", "spend $100 off retail"]) {
      const result = evaluateClaimSafety({ text });
      expect(result.verdict, text).toBe("flagged");
      expect(
        result.violations.map((v) => v.category),
        text,
      ).toContain("hallucinated-offer");
    }
  });

  it("keeps the existing letter-currency offer matches ('RM50 off' / 'usd 20 off')", () => {
    for (const text of ["RM50 off every package", "usd 20 off today only stuff aside"]) {
      const result = evaluateClaimSafety({ text });
      expect(result.verdict, text).toBe("flagged");
      expect(
        result.violations.map((v) => v.category),
        text,
      ).toContain("hallucinated-offer");
    }
  });
});

describe("evaluateClaimSafety - hardening: superiority words from claim-boundaries.md", () => {
  it("flags 'leading <noun>', 'unrivaled', and 'No.1'/'No. 1'", () => {
    const cases = [
      "We are the leading clinic for laser in the region.",
      "Honestly our results here are simply unrivaled.",
      "We're the No.1 medspa for this, hands down.",
      "Voted No. 1 clinic three years running.",
    ];
    for (const text of cases) {
      const result = evaluateClaimSafety({ text });
      expect(result.verdict, text).toBe("flagged");
      expect(
        result.violations.map((v) => v.category),
        text,
      ).toContain("superiority");
    }
  });

  it("does not false-positive on benign 'leading' uses", () => {
    for (const text of [
      "Leading up to your appointment, please drink plenty of water.",
      "The leading edge of the table was a little scratched.",
    ]) {
      expect(evaluateClaimSafety({ text }).verdict, text).toBe("clean");
    }
  });
});

describe("evaluateClaimSafety - hardening: paraphrase / synonym residual now flagged", () => {
  it("flags each previously-missed paraphrase with the right category", () => {
    const cases: Array<{ text: string; category: ClaimViolationCategory }> = [
      // efficacy paraphrases
      { text: "This will completely transform your skin in one session.", category: "efficacy" },
      { text: "Trust me, transform your skin in weeks.", category: "efficacy" },
      { text: "This serum is going to fix your acne.", category: "efficacy" },
      { text: "This treatment will fix your acne for good.", category: "efficacy" },
      { text: "Your wrinkles will disappear, I'm telling you.", category: "efficacy" },
      { text: "Dark spots disappear after 3 sessions.", category: "efficacy" },
      { text: "It eliminates acne fast.", category: "efficacy" },
      { text: "This will eliminate your wrinkles.", category: "efficacy" },
      { text: "I promise you real results.", category: "efficacy" },
      { text: "I promise visible results, trust me.", category: "efficacy" },
      { text: "It's 100 percent effective.", category: "efficacy" },
      { text: "This is ninety percent effective at clearing acne.", category: "efficacy" },
      // safety
      { text: "The whole treatment is completely painless.", category: "safety-claim" },
      // credentials (reversed word order, not just 'FDA-approved')
      { text: "This device is approved by the FDA.", category: "credentials" },
      // offers (spelled-out, not just '%' / '$')
      { text: "Get fifty percent off your first visit.", category: "hallucinated-offer" },
      { text: "Everything is half price this month.", category: "hallucinated-offer" },
    ];
    for (const { text, category } of cases) {
      const result = evaluateClaimSafety({ text });
      expect(result.verdict, text).toBe("flagged");
      expect(
        result.violations.map((v) => v.category),
        text,
      ).toContain(category);
    }
  });
});

describe("evaluateClaimSafety - hardening: the new rules add NO false positives", () => {
  it("keeps a benign corpus clean (paraphrase/superiority/offer additions do not over-trip)", () => {
    const benign = [
      "Leading up to your appointment, please drink plenty of water.",
      "The leading edge of the table was a little scratched.",
      "Transform your routine with one small daily habit.",
      "I promise to call you back about your appointment.",
      "Let's eliminate the guesswork and just book a consult.",
      "This is going to fix my schedule once and for all.",
      "We're fully booked this week, thanks everyone.",
      "The swelling tends to go down after a couple of days.",
      "Half the fun is the consultation itself.",
      "Ninety percent of people book a follow-up consult.",
      "Endorsed by our happiest regulars, honestly.",
    ];
    for (const text of benign) {
      const result = evaluateClaimSafety({ text });
      expect(result.verdict, text).toBe("clean");
      expect(result.violations, text).toHaveLength(0);
    }
  });
});

describe("deriveClaimsPolicyTag - producer side (scripting)", () => {
  it("maps a clean verdict to 'clean'", () => {
    expect(deriveClaimsPolicyTag({ verdict: "clean", violations: [] })).toBe("clean");
  });

  it("maps a flagged verdict to 'review_required'", () => {
    expect(
      deriveClaimsPolicyTag({
        verdict: "flagged",
        violations: [{ category: "efficacy", matchedText: "guaranteed", rule: "x" }],
      }),
    ).toBe("review_required");
  });
});

describe("parseClaimsPolicyTag - consumer side (production gate)", () => {
  it("treats a missing tag as clean (backward compatible: absent = not evaluated)", () => {
    expect(parseClaimsPolicyTag(undefined)).toBe("clean");
    expect(parseClaimsPolicyTag(null)).toBe("clean");
  });

  it("passes through recognized tags", () => {
    expect(parseClaimsPolicyTag("clean")).toBe("clean");
    expect(parseClaimsPolicyTag("review_required")).toBe("review_required");
  });

  it("fails closed on a present-but-unrecognized (tampered/garbage) tag", () => {
    expect(parseClaimsPolicyTag("totally-fine-trust-me")).toBe("review_required");
    expect(parseClaimsPolicyTag(42)).toBe("review_required");
  });
});

describe("CLAIM_SAFETY_RULES - ruleset is grounded + traceable", () => {
  it("every rule cites the claim-boundary / source rule it enforces", () => {
    expect(CLAIM_SAFETY_RULES.length).toBeGreaterThan(0);
    for (const rule of CLAIM_SAFETY_RULES) {
      expect(rule.rule.length).toBeGreaterThan(0);
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });
});
