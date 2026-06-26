import { describe, it, expect } from "vitest";
import { CORPUS, CONTROLS, corpusHash } from "../corpus.js";
import { ClaimBoundaryCorpusSchema, PROHIBITED_CLAIM_TYPES } from "../schema.js";
import { gradeClaim } from "../grade-claim.js";

describe("claim-boundary corpus", () => {
  it("is schema-valid (validated at module load, asserted here too)", () => {
    expect(ClaimBoundaryCorpusSchema.safeParse(CORPUS).success).toBe(true);
  });

  it("covers every prohibited claimType in the taxonomy", () => {
    const present = new Set(CORPUS.map((c) => c.claimType));
    for (const t of PROHIBITED_CLAIM_TYPES) {
      expect(present.has(t), `missing a claim-bait case for "${t}"`).toBe(true);
    }
  });

  it("targets only Alex's inbound seam (Mira leg is EV-6)", () => {
    for (const c of CORPUS) expect(c.seam).toBe("alex-inbound");
  });

  // TEETH: the grader must FLAG every prohibited sentence — no silently-dead case.
  it("flags every case's prohibitedSentence (real teeth)", () => {
    for (const c of CORPUS) {
      const grade = gradeClaim({ responseText: c.prohibitedSentence, crashed: false }, c.expect);
      expect(grade.pass, `"${c.id}" prohibitedSentence was NOT flagged`).toBe(false);
    }
  });

  // FALSE-POSITIVE GUARD: the grader must PASS every resistant sentence.
  it("passes every case's resistantSentence (no false positive on the safe path)", () => {
    for (const c of CORPUS) {
      const grade = gradeClaim({ responseText: c.resistantSentence, crashed: false }, c.expect);
      expect(
        grade.pass,
        `"${c.id}" resistantSentence was wrongly flagged: ${grade.violations.map((v) => v.code).join(", ")}`,
      ).toBe(true);
    }
  });

  it("places each forbiddenClaimPhrase verbatim in the prohibited sentence, absent from the resistant one", () => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
    for (const c of CORPUS) {
      for (const phrase of c.expect.forbiddenClaimPhrases) {
        expect(
          norm(c.prohibitedSentence).includes(norm(phrase)),
          `"${c.id}": "${phrase}" not in prohibitedSentence`,
        ).toBe(true);
        expect(
          norm(c.resistantSentence).includes(norm(phrase)),
          `"${c.id}": "${phrase}" leaked into resistantSentence`,
        ).toBe(false);
      }
    }
  });

  // NIT GUARD (reviewer future-proofing): the grader splits each sentence on
  // contrastive-conjunction tokens (", but" / ", though" / ", however" / ", yet" /
  // ", whereas" / ";") into clauses BEFORE the per-case forbidden-phrase teeth run
  // (see CONTRASTIVE_CLAUSE_SPLIT in grade-claim.ts). A forbiddenClaimPhrase that
  // straddled such a token would be silently bisected and never match, leaving a
  // dead tooth. None do today; this pins it.
  it("has no forbiddenClaimPhrase containing a contrastive-split token (would be bisected before the teeth)", () => {
    const CONTRASTIVE_SPLIT_TOKEN = /,\s+(?:but|though|however|whereas|yet)\b|;/i;
    for (const c of CORPUS) {
      for (const phrase of c.expect.forbiddenClaimPhrases) {
        expect(
          CONTRASTIVE_SPLIT_TOKEN.test(phrase),
          `"${c.id}": forbiddenClaimPhrase ${JSON.stringify(phrase)} contains a contrastive-split token (", but" / ", though" / ", however" / ", yet" / ", whereas" / ";"). gradeClaim splits clauses on these before the phrase teeth, so the phrase would be silently bisected. Reword it to a single clause.`,
        ).toBe(false);
      }
    }
  });

  // The control proof: ordinary benign replies are never flagged.
  it("passes every control cleanReply (grader does not over-flag conversational replies)", () => {
    for (const c of CONTROLS) {
      const grade = gradeClaim({ responseText: c.cleanReply, crashed: false });
      expect(
        grade.pass,
        `control "${c.id}" cleanReply was wrongly flagged: ${grade.violations.map((v) => v.code).join(", ")}`,
      ).toBe(true);
    }
  });

  it("produces a stable 16-hex corpus hash", () => {
    expect(corpusHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(corpusHash()).toBe(corpusHash());
  });
});
