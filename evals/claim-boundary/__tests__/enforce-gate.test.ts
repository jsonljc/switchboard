import { describe, it, expect } from "vitest";
import type { ClaimType } from "@switchboard/schemas";
import { runClaimEnforceGate, makeStubClaimClassifier } from "../enforce-gate.js";
import { gradeClaim } from "../grade-claim.js";
import { CORPUS } from "../corpus.js";
import type { ClaimBoundaryCase } from "../schema.js";

const REWRITEABLE = new Set<ClaimType>(["efficacy", "safety-claim", "superiority", "urgency"]);

/** Stub classifier that labels the case's bait sentence as its claimType, else "none". */
function stubForCase(c: ClaimBoundaryCase) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const phrases = c.expect.forbiddenClaimPhrases.map(norm);
  return makeStubClaimClassifier((sentence) =>
    phrases.some((p) => norm(sentence).includes(p)) ? c.claimType : "none",
  );
}

describe("classifier-ENFORCE offline teeth — the real ClaimClassifierHook over stub stores", () => {
  it("REWRITES a rewriteable claim (efficacy/safety/superiority/urgency) and neutralizes it", async () => {
    for (const c of CORPUS.filter((x) => REWRITEABLE.has(x.claimType))) {
      const outcome = await runClaimEnforceGate({
        response: c.prohibitedSentence,
        classifier: stubForCase(c),
      });
      expect(outcome.action, `"${c.id}" should rewrite`).toBe("rewrite");
      expect(outcome.rewritten).toBe(true);
      expect(outcome.finalResponse).not.toBe(c.prohibitedSentence);
      // The post-gate reply must no longer assert a prohibited claim.
      expect(
        gradeClaim({ responseText: outcome.finalResponse, crashed: false }).pass,
        `"${c.id}" post-rewrite still flagged`,
      ).toBe(true);
      expect(outcome.verdicts.some((v) => v.action === "rewrite")).toBe(true);
    }
  });

  it("ESCALATES an escalate-only claim (testimonial/medical-advice/diagnosis/credentials) to a human", async () => {
    for (const c of CORPUS.filter((x) => !REWRITEABLE.has(x.claimType))) {
      const outcome = await runClaimEnforceGate({
        response: c.prohibitedSentence,
        classifier: stubForCase(c),
      });
      expect(outcome.action, `"${c.id}" should escalate`).toBe("escalate");
      expect(outcome.escalated).toBe(true);
      expect(outcome.finalResponse).not.toBe(c.prohibitedSentence);
      expect(
        gradeClaim({ responseText: outcome.finalResponse, crashed: false }).pass,
        `"${c.id}" handoff still flagged`,
      ).toBe(true);
      expect(outcome.verdicts.some((v) => v.action === "escalate")).toBe(true);
    }
  });

  it("does NOT act when the classifier returns none (a clean reply is left untouched)", async () => {
    const clean = "Laser hair removal reduces hair growth over several sessions.";
    const outcome = await runClaimEnforceGate({
      response: clean,
      classifier: makeStubClaimClassifier(() => "none"),
    });
    expect(outcome.action).toBe("none");
    expect(outcome.finalResponse).toBe(clean);
    expect(outcome.verdicts).toHaveLength(0);
  });

  it("escalate takes precedence when a turn mixes a rewriteable and an escalate-only claim", async () => {
    // Two sentences: one efficacy (rewriteable), one diagnosis (escalate-only).
    const response =
      "This is guaranteed to permanently clear your skin. Based on what you describe, that's melasma.";
    const classifier = makeStubClaimClassifier((sentence) =>
      /melasma/i.test(sentence) ? "diagnosis" : /guaranteed/i.test(sentence) ? "efficacy" : "none",
    );
    const outcome = await runClaimEnforceGate({ response, classifier });
    expect(outcome.action).toBe("escalate");
    expect(outcome.escalated).toBe(true);
    expect(gradeClaim({ responseText: outcome.finalResponse, crashed: false }).pass).toBe(true);
  });
});

describe("OFF vs ENFORCE — the same prohibited reply is caught by the grader and neutralized by the gate", () => {
  it("for every taxonomy case: grader FAILS the raw claim, ENFORCE gate makes the grader PASS", async () => {
    for (const c of CORPUS) {
      // classifier OFF view: the raw prohibited reply asserts a claim -> grader fails.
      expect(
        gradeClaim({ responseText: c.prohibitedSentence, crashed: false }, c.expect).pass,
      ).toBe(false);
      // classifier ENFORCE view: the gate neutralizes it -> grader passes.
      const outcome = await runClaimEnforceGate({
        response: c.prohibitedSentence,
        classifier: stubForCase(c),
      });
      expect(outcome.action).not.toBe("none");
      expect(
        gradeClaim({ responseText: outcome.finalResponse, crashed: false }).pass,
        `"${c.id}" not neutralized by ENFORCE`,
      ).toBe(true);
    }
  });
});
