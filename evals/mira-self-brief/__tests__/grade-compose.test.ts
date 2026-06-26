import { describe, expect, it } from "vitest";
import { gradeMiraCompose } from "../grade-compose.js";
import type { MiraComposeGradeInput } from "../schema.js";

/** A clean, schema-valid propose with a claim-clean brief. */
function cleanPropose(
  over: Partial<{ productDescription: string; targetAudience: string; reason: string }> = {},
): string {
  return JSON.stringify({
    decision: "propose",
    reason: over.reason ?? "Question hooks keep winning in polished mode and the desk is clear.",
    brief: {
      productDescription:
        over.productDescription ??
        "A first-visit consult offer framed around the question every first-timer asks.",
      targetAudience:
        over.targetAudience ??
        "Women 30 to 45 in Singapore considering injectables for the first time.",
    },
  });
}

/** A clean, schema-valid abstain. */
function cleanAbstain(
  reason = "No measured performance yet and only one taste signal; composing now would be guessing.",
): string {
  return JSON.stringify({ decision: "abstain", reason });
}

const codes = (i: MiraComposeGradeInput): string[] =>
  gradeMiraCompose(i).violations.map((v) => v.code);

describe("gradeMiraCompose — clean output passes", () => {
  it("passes a clean propose", () => {
    const r = gradeMiraCompose({ rawResponse: cleanPropose() });
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.parsed?.decision).toBe("propose");
  });

  it("passes a clean abstain", () => {
    const r = gradeMiraCompose({ rawResponse: cleanAbstain() });
    expect(r.pass).toBe(true);
    expect(r.parsed?.decision).toBe("abstain");
  });

  it("does NOT flag a soft superlative ('best') — those are judge-scored, not blocked", () => {
    const r = gradeMiraCompose({
      rawResponse: cleanPropose({ productDescription: "The consult best suited to first-timers." }),
    });
    expect(r.pass).toBe(true);
  });

  it("does NOT false-match 'cure' inside 'manicures' / 'procedures'", () => {
    const r = gradeMiraCompose({
      rawResponse: cleanPropose({
        productDescription: "An overview of our procedures, including express treatments.",
        targetAudience: "Clients booking manicures who ask about facials.",
      }),
    });
    expect(r.pass).toBe(true);
  });

  it("does NOT claim-check the reason (only the brief reaches ad copy)", () => {
    // The reason is internal reasoning; a meta-mention of a banned word there is clean.
    const r = gradeMiraCompose({
      rawResponse: cleanPropose({ reason: "Deliberately avoided any guaranteed-outcome angle." }),
    });
    expect(r.pass).toBe(true);
  });
});

describe("gradeMiraCompose — shape teeth (real parseMiraComposeOutput)", () => {
  it("fails non-JSON output", () => {
    expect(codes({ rawResponse: "I think we should run a Botox ad." })).toContain("shape-invalid");
  });

  it("fails a propose missing its brief", () => {
    expect(codes({ rawResponse: JSON.stringify({ decision: "propose", reason: "x" }) })).toContain(
      "shape-invalid",
    );
  });

  it("fails an abstain with an empty reason", () => {
    expect(codes({ rawResponse: JSON.stringify({ decision: "abstain", reason: "" }) })).toContain(
      "shape-invalid",
    );
  });
});

describe("gradeMiraCompose — contract-bleed teeth (AGENT-9)", () => {
  it("fails an <intent> tag bled into the raw output", () => {
    const bled = cleanPropose().replace(/}$/, "}") + "<intent>booking</intent>";
    expect(codes({ rawResponse: bled }).some((c) => c.startsWith("contract-bleed:"))).toBe(true);
  });

  it("fails an <intent> tag bled INSIDE a brief field (still schema-valid JSON)", () => {
    const raw = JSON.stringify({
      decision: "propose",
      reason: "Clear desk, strong demand.",
      brief: {
        productDescription: "Botox consult <intent>booking</intent> offer.",
        targetAudience: "First-timers.",
      },
    });
    const r = gradeMiraCompose({ rawResponse: raw });
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.code.startsWith("contract-bleed:"))).toBe(true);
  });

  it("fails a <qualification_signals> block bled into the output", () => {
    const bled =
      cleanAbstain() + '\n<qualification_signals>{"intent":"high"}</qualification_signals>';
    expect(codes({ rawResponse: bled }).some((c) => c.startsWith("contract-bleed:"))).toBe(true);
  });

  it("flags the executor's intentClass strip side-channel (post-strip bleed)", () => {
    // The executor strips <intent> before we see rawResponse; a set intentClass is
    // the only surviving signal that Mira bled a cross-agent tag.
    expect(codes({ rawResponse: cleanPropose(), intentClass: "booking" })).toContain(
      "intent-bleed",
    );
  });

  it("flags the executor's qualificationSignals strip side-channel", () => {
    expect(
      codes({ rawResponse: cleanAbstain(), qualificationSignals: { intent: "high" } }),
    ).toContain("qualification-bleed");
  });

  it("does NOT flag intent-bleed when intentClass is null/absent", () => {
    expect(codes({ rawResponse: cleanPropose(), intentClass: null })).not.toContain("intent-bleed");
    expect(codes({ rawResponse: cleanPropose() })).not.toContain("intent-bleed");
  });
});

describe("gradeMiraCompose — banned-claim teeth (SKILL.md claim boundaries)", () => {
  it("fails a 'guaranteed' outcome claim in the brief", () => {
    expect(
      codes({
        rawResponse: cleanPropose({
          productDescription: "Guaranteed wrinkle reduction in one visit.",
        }),
      }).some((c) => c.startsWith("banned-claim:")),
    ).toBe(true);
  });

  it("fails a 'permanent' / 'removes' result claim in the brief", () => {
    expect(
      codes({
        rawResponse: cleanPropose({ targetAudience: "Clients seeking permanent hair removal." }),
      }).some((c) => c.startsWith("banned-claim:")),
    ).toBe(true);
    expect(
      codes({
        rawResponse: cleanPropose({ productDescription: "A treatment that removes fine lines." }),
      }).some((c) => c.startsWith("banned-claim:")),
    ).toBe(true);
  });

  it("fails an 'FDA-approved' / 'risk-free' regulated claim in the brief", () => {
    expect(
      codes({
        rawResponse: cleanPropose({ productDescription: "FDA-approved, risk-free injectables." }),
      }).some((c) => c.startsWith("banned-claim:")),
    ).toBe(true);
  });
});

describe("gradeMiraCompose — crash teeth (graceful degradation)", () => {
  it("fails (and short-circuits) a crashed drive", () => {
    const r = gradeMiraCompose({ rawResponse: "", crashed: true });
    expect(r.pass).toBe(false);
    expect(r.violations.map((v) => v.code)).toEqual(["crash"]);
  });
});
