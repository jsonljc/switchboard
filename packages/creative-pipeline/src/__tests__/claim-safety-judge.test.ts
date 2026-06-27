import { describe, it, expect } from "vitest";
import { z } from "zod";
import { callClaude } from "../stages/call-claude.js";
import { evaluateClaimSafety } from "../ugc/claim-safety.js";

// EV-13 part C - informational LLM-judge claim-safety rubric.
//
// The BLOCKING claim leg is the deterministic detector (claim-safety.test.ts); it
// runs with no key and gates production. This live judge is a SECOND, semantic
// opinion: deterministic lexical rules cannot catch every paraphrase of a banned
// claim, so an LLM reviewer reading the whole script is a useful informational
// signal for tuning the ruleset over time.
//
// Per the no-key build-loop convention (idiom (b)), it is gated on
// ANTHROPIC_API_KEY and never spends in a normal CI run. No baseline is baked and
// no "fake live pass" is asserted: when the key is absent the suite SKIPS (it does
// not green a stubbed call). When the key is present it makes a real call and
// asserts the judge agrees an egregious script is unsafe; the clean-script verdict
// is logged informationally (a conservative judge must never silently weaken the
// deterministic gate, which remains the source of truth).

const JUDGE_SYSTEM_PROMPT = [
  "You are a medspa advertising-compliance reviewer for a regulated aesthetic-clinic",
  "vertical (Singapore / Malaysia). You enforce these non-negotiable claim boundaries:",
  "- never guarantee results, outcomes, or timelines (no 'guaranteed', 'permanent', '100%',",
  "  'you will see', 'it will fix');",
  "- never assert personal safety or 'no side effects' / 'no downtime';",
  "- never claim regulatory approval as proof (e.g. 'FDA-approved');",
  "- never diagnose a viewer's condition;",
  "- no superiority claims without evidence; no manufactured urgency/scarcity;",
  "- no testimonials or personal before/after outcome anecdotes;",
  "- no fabricated discounts/offers not provided by the operator.",
  "Read the whole UGC ad script and decide whether it crosses ANY boundary.",
  'Reply ONLY with JSON: {"unsafe": boolean, "categories": string[], "reasoning": string}.',
].join("\n");

const JudgeVerdictSchema = z.object({
  unsafe: z.boolean(),
  categories: z.array(z.string()),
  reasoning: z.string(),
});

const BANNED_SCRIPT =
  "Okay listen, this treatment is FDA-approved and it's 100% safe for you, no side effects at all. " +
  "You will see permanent, guaranteed results in 2 weeks. We're the best clinic in town and only a " +
  "few slots are left, so book today before this price ends soon!";

const CLEAN_SCRIPT =
  "Hey so honestly I'd been curious about these treatments for ages. I finally booked a consultation " +
  "and what I liked is the doctor actually walked me through what it does and whether it even made " +
  "sense for me. No pressure. If you're curious too, book a consult and ask them your questions.";

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  "claim-safety LLM judge (informational, live; gated on ANTHROPIC_API_KEY)",
  () => {
    it("agrees an egregious banned-claim script is unsafe (and the deterministic detector also flags it)", async () => {
      // The deterministic gate must already flag this (sanity: the two agree).
      expect(evaluateClaimSafety({ text: BANNED_SCRIPT }).verdict).toBe("flagged");

      const verdict = await callClaude({
        apiKey,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userMessage: `UGC ad script:\n\n${BANNED_SCRIPT}`,
        schema: JudgeVerdictSchema,
        maxTokens: 512,
      });
      console.warn("[claim-safety-judge] banned-script verdict:", JSON.stringify(verdict));
      expect(verdict.unsafe).toBe(true);
    }, 30_000);

    it("reads a compliant script as safe (informational: logs the verdict, never weakens the gate)", async () => {
      // Deterministic gate passes the clean script.
      expect(evaluateClaimSafety({ text: CLEAN_SCRIPT }).verdict).toBe("clean");

      const verdict = await callClaude({
        apiKey,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userMessage: `UGC ad script:\n\n${CLEAN_SCRIPT}`,
        schema: JudgeVerdictSchema,
        maxTokens: 512,
      });
      // Informational only: a conservative judge flagging a clean script is logged
      // for ruleset tuning, but the deterministic detector stays the source of truth.
      console.warn("[claim-safety-judge] clean-script verdict:", JSON.stringify(verdict));
      expect(typeof verdict.unsafe).toBe("boolean");
    }, 30_000);
  },
);
