# Alex freeze-gate: classifier confidence floor + escalation over-flag narrowing

**Date:** 2026-06-03
**Branch:** `feat/alex-freeze-gate` (off `origin/main` @ `9e244dd7`)
**Audit source:** `docs/audits/2026-06-02-alex-improvement-audit/` (PR #805): findings T1.1, T1.2 (cluster), T1.5; execution-plan.md:53-59 "Freeze gate".

## 1. Why now

The audit defines a **freeze gate**: "No feature/learning-loop PR past this line until PR-0/A/B are merged and the counters are live. Then, _before_ the planned classifier `off→enforce` and router flips:", and the first two items are (1) the claim-classifier **confidence floor** and (2) **over-escalation narrowing + negation guards + self-disclosed-minor trigger**.

Verified state (2026-06-03): PR-0 (#833), PR-A (#799), PR-B (#838) are all merged into `origin/main`. The gate is the live line. The classifier `off→enforce` flip and the deterministic pre-input-gate `off→enforce` flip are landmines without this work:

- **Over-escalation is the audit's #1 conversion leak**: the system hands high-intent / high-value leads to humans at exactly the wrong moments.
- **One bright-line safety gap**: a self-disclosed minor ("I'm 16, can I get fillers?") currently bypasses the minor trigger entirely (SG/MY consent risk).

This slice de-risks the classifier flip specifically. The router-flip prerequisites (T2.6 trace/cache telemetry, T2.9 router-on eval) are a **separate** flip and are intentionally **out of scope**, keeping this disjoint from concurrent sessions.

## 2. Scope

**In scope** (5 findings, all verified still-open against `origin/main`):

| ID    | Finding                                                                                                        | Layer                 | File                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| T1.1  | Confidence recorded but never gates a decision                                                                 | output (Alex's reply) | `governance-config.ts`, `skill-runtime/hooks/claim-classifier.ts` |
| T1.2a | Bare "anxious"/"anxiety" escalates (collides with designed aesthetic-anxiety objection)                        | input (user msg)      | `escalation-triggers/common.ts`                                   |
| T1.2b | `sensitive_keyword` / `multi_treatment_combo` have no negation guard ("I'm NOT diabetic", "my mum had cancer") | input                 | `escalation-triggers/common.ts`                                   |
| T1.2c | Substantiation match is verbatim-substring only, so paraphrased approved claims escalate                       | output                | `governance/classifier/substantiation-resolver.ts`                |
| T1.5  | Self-disclosed minor age not flagged (only third-party phrasing matches)                                       | input                 | `escalation-triggers/common.ts`                                   |

**Two layers** (a clean seam: they do not share code):

- **Input path.** The deterministic _pre-input gate_ runs on the **user's incoming message**: `pre-input-gate.ts` calls `loadEscalationTriggers`, then `scanForEscalationTriggers` (matcher) over `COMMON_ESCALATION_TRIGGERS` (data). T1.2a, T1.2b, T1.5 live here.
- **Output path.** The _claim-classifier hook_ runs on **Alex's drafted reply**: `ClaimClassifierHook.afterSkill` calls `decideAction`, which calls `substantiationResolver.resolve`. T1.1 and T1.2c live here.

**Explicitly NOT touched (do not loosen):**

- The **4 locked medical red flags** from #791 (changing/darkening mole; pregnancy/breastfeeding + treatment; blood-thinners + injectable; recent in-area surgery + energy device). Critical fact: #791 implemented these in `skills/alex/SKILL.md` (the LLM prompt) plus the `escalate` tool reason enum, **not** in `common.ts` or the scanner. So edits to `common.ts` cannot loosen them; they are a different layer. Controlled-thyroid / lupus remain consult-redirects, not escalations. We touch none of this.
- `skills/alex/SKILL.md` prose is unchanged, so the ungoverned Alex conversation eval does not move.
- The regulatory-public-source matcher in `substantiation-resolver.ts` (`matchRegulatory`). Only `matchClaim` (the approved-claim tier) gets paraphrase tolerance.

## 3. Design

### T1.1: enforced confidence floor (output path)

**Schema** (`packages/schemas/src/governance-config.ts`, `ClaimClassifierConfigSchema`): add

```ts
confidenceThreshold: z.number().min(0).max(1).default(0.7),
```

This is a key in the existing `governanceConfig.claimClassifier` passthrough JSON sub-block. **No Prisma migration** (the file's own doc-comment documents this: the JSON column accepts arbitrary sub-blocks; defaults are applied by `resolveClaimClassifierConfig`). It is a **principled config default, not an operator UI knob** ("modes not knobs"): default 0.7, tunable in config, no dashboard surface.

**Decision point** (`packages/core/src/skill-runtime/hooks/claim-classifier.ts`, `decideAction`): pass `confidenceThreshold` from the resolved `classifierConfig` into `decideAction` (alongside the existing `latencyBudgetMs`), and gate immediately after the `none` check:

```ts
if (result.claimType === "none") return { kind: "allow" };

// T1.1 confidence floor: a sub-threshold classification is not trusted to rewrite
// or escalate a turn. Below the floor we treat the sentence as allowed rather than
// acting on a guess. This is the de-risk for the off->enforce flip (root of over-flag
// #673): on day one the classifier must not rewrite/escalate a large fraction of
// normal turns on low-confidence guesses.
if (result.confidence < confidenceThreshold) return { kind: "allow" };
```

**Semantics and locked decisions:**

- The floor is **uniform** across all non-`none` claim types (one threshold, one behavior, per "modes not knobs"). It applies only to the success path; classifier `error`/`timeout` outcomes (which carry no confidence) still escalate fail-safe, unaffected.
- **Direction is allow, not escalate.** A low-confidence classification means the classifier is unsure the sentence is a claim. The audit is explicit that _over_-escalation is the conversion leak, so the rule is "when unsure, do not disrupt the turn", i.e. allow. Routing-the-unsure-case-to-a-human is exactly the behavior we are removing.
- **Bounded tradeoff:** the floor trades a small number of false negatives (a genuine claim the classifier is only 0.6-0.7 sure about now passes) for a large reduction in false positives on normal turns. The residual risk is acceptable because (a) egregious claims score high confidence, (b) patient-safety red flags are handled by the separate prompt layer, and (c) the classifier governs Alex's _own marketing copy_, where over-rewriting benign reassurance is the documented #673 failure.

### T1.2a: narrow bare anxiety (input path)

`common.ts` `sensitive_keyword_mental_health` pattern. Drop standalone `anxiety|anxious`; require clinical forms:

```ts
patterns: [
  /\b(depress(ed|ion)|suicidal|self.harm|eating disorder|anorexia|bulimia|panic attacks?|anxiety disorder)\b/i,
],
```

Genuine crisis signals (depression, suicidal, self-harm, eating disorders, panic attacks, anxiety **disorder**) still escalate. Bare "anxious"/"anxiety" no longer fires; it is exactly the "aesthetic anxiety" objection Alex is _designed_ to handle (and the same vocabulary `emotional-classifier.ts` / `package-assembler.ts` use for objection tagging). High precision: we narrow only what the audit flagged; depression/suicidal/etc. are unchanged.

### T1.2b: negation guards (input path)

The matcher already supports per-entry `negations` (suppress the entry for a sentence if any negation matches). Add high-precision `negations` arrays (mirroring the existing pregnancy style, where the negation is bound to the keyword within a sentence, blocked by `.!?`):

- **`sensitive_keyword_medical_condition`**: (1) self-negation, e.g. `not/never/don't/doesn't/isn't/haven't ... <condition>` and `no (history of) <condition>`; (2) third-party attribution, e.g. `my/her/his/their <relative> ... <condition>` ("my mum had cancer"). Patterns bind the negator/relative to the condition with a short bounded gap to stay precise.
- **`multi_treatment_combo`**: negation, e.g. `don't / rather not / avoid / without ... combine|stack|together|same day`.
- **`sensitive_keyword_mental_health`**: self-negation of the (now clinical) terms, e.g. "I'm not suicidal", "I don't have depression".

**Precision rule (locked):** suppress only the clear negation / third-party shapes; never suppress a first-person present-tense condition ("I have diabetes", "I'm diabetic" still escalate). **Documented limitation:** because the matcher suppresses an entry per-sentence when any negation matches, a _single sentence_ containing **both** a third-party condition **and** a first-person condition ("my mum had cancer and I have diabetes") will be over-suppressed. This is rare, and a first-person condition in its own sentence is unaffected (per-sentence scan). Flagged for the adversarial pass.

### T1.2c: paraphrase-tolerant substantiation (output path)

`substantiation-resolver.ts` `matchClaim` only. Add a conservative paraphrase path beside the existing exact-substring fast path:

```ts
const hit = sentenceLower.includes(claimLower) || paraphraseMatches(sentenceLower, claimLower);
```

`paraphraseMatches`:

- Tokenize the approved claim into **significant tokens** (lowercase, strip punctuation, drop stopwords and length<2; **keep numbers**, since "50%" is not "80%").
- Match **only if every** significant claim token is present in the sentence's token set (containment = 1.0, order-independent). This catches reordered / word-inserted paraphrases while never matching a sentence that omits a key claim term.
- **Negation guard:** if the sentence contains a negation word, the paraphrase path returns false (do not let "not clinically proven" substantiate "clinically proven"). The exact-substring fast path is unchanged (existing behavior and tests preserved).

**Risk bound (locked):** the failure mode of a fuzzy matcher is a false _positive_ (an unsubstantiated claim allowed, i.e. a compliance miss). Containment-of-all-key-terms plus the negation guard keeps this tight; the only new matches are sentences that contain every approved-claim term. This is the hardest item for the adversarial pass. If review finds it unsafe to land, it splits to a follow-up and the other four ship.

### T1.5: self-disclosed minor (input path), a bright line

`common.ts` `sensitive_keyword_minor`. Keep the existing third-party pattern, add first-person patterns:

```ts
patterns: [
  /\b(my (daughter|son)|teenage|under ?\s?(16|18))\b/i,
  // self-disclosed age 10-17 (numeric or spelled), with a unit lookahead so
  // "16 years of experience" / "16 weeks" / "160cm" do not false-trigger
  /\bi(?:'?m| am| was)\s+(?:only\s+|just\s+|almost\s+|nearly\s+|turning\s+)?(1[0-7]|thirteen|fourteen|fifteen|sixteen|seventeen)\b(?!\s*(?:years?\s+of|weeks?|months?|days?|hours?|min(?:ute)?s?|kg|kgs|lbs?|pounds?|stone|cm|%|percent|sessions?|times?|grand|dollars?))/i,
  /\bi(?:'?m| am)\s+(?:a\s+)?(minor|underage|under ?18|not (yet )?18|below 18)\b/i,
],
```

Conservative and precise per the user constraint: matches "I'm 16", "I am 15", "im 14, can I...", "I'm a minor"; does **not** match "16 years of experience", "I'm 16 weeks pregnant", "I'm 160cm", "I'm 18", "I lost 16 pounds". `\b` after `1[0-7]` rejects "160"; the unit lookahead rejects duration/measure phrasings; "years old" is allowed (a real minor). 18 is excluded (can consent).

## 4. Testing strategy

Every capability touched gets a unit test **and** a production-path test (per the production-path-integration-test invariant). Tests are co-located, mirroring existing suites.

- **T1.1.** `schemas/src/__tests__/governance-config.test.ts`: default 0.7, in-range parse, out-of-range reject, `resolveClaimClassifierConfig` surfaces it. `core/.../hooks/__tests__/claim-classifier.test.ts` (the **live decision path**, LLM boundary mocked): confidence 0.6 plus a rewriteable claim leaves the response unchanged with no rewrite/escalate verdict; confidence 0.8 rewrites/escalates as before; the floor is configurable; error/timeout still escalate.
- **T1.2 / T1.5 unit.** New `escalation-triggers/__tests__/common.test.ts` runs the **real** `COMMON_ESCALATION_TRIGGERS` through the **real** `scanForEscalationTriggers`: "I'm so anxious about my results" gives no mental-health match; "I have an anxiety disorder" / "I feel suicidal" match; "I'm not diabetic" / "my mum had cancer" give no medical-condition match; "I have diabetes" / "I'm diabetic" match; "My mum had cancer. I have diabetes too." (two sentences) still matches on diabetes; "I'm 16, can I get fillers?" matches minor; precision negatives ("16 years of experience", "I'm 160cm", "I'm 18") do not match.
- **T1.5 / T1.2 live gate.** `channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts` (the **real pre-input gate**, enforce mode, real loader and scanner): "hi I'm 16, can I get fillers?" escalates (status to `human_override`, handoff saved); "I'm so anxious about how I'll look" does **not** escalate (the narrowing proven on the live path).
- **T1.2c.** `governance/classifier/__tests__/substantiation-resolver.test.ts`: a paraphrase with all key terms present plus an approved claim is matched; a paraphrase missing a key term is missing (still escalates); a negated paraphrase is missing; the exact-substring path is unchanged (existing cases green).
- **Adversarial.** `/codex:adversarial-review` on the diff, focused on (a) floor direction safety, (b) negation-guard false suppression of genuine conditions, (c) paraphrase false-positive substantiation, (d) minor-regex precision.

**Eval impact (verified):**

- The claim-classifier eval scores `claimType` label accuracy via `invoke-classifier.ts`, **bypassing the hook decision path entirely**; the prompt-hash covers only `CLASSIFIER_SYSTEM_PROMPT` plus the claim-type enum. T1.1 (hook) and T1.2c (resolver) change neither, so the baseline `6aed7131cf224c76` and the prompt-hash are **untouched, no re-lock**. T1.2c lives under `governance/classifier/**`, so it _triggers_ the (non-required) eval job, but cannot change `classify()` output. The classifier eval is currently RED on `main` for an **infra reason (401 invalid API key)**, not a regression. **Do not touch the baseline** (#631 bake to >=2026-06-06).
- No `skills/alex/SKILL.md` change, so the Alex conversation eval is unaffected. No new cross-package eval imports, so no ci.yml eval-build changes.

**No migration:** a Zod schema field on a JSON passthrough sub-block; `prisma/schema.prisma` is untouched; `db:check-drift` is N/A (and Postgres is down, so unit tests use mocked Prisma).

## 5. Out of scope / follow-ups

- Router-flip prerequisites (T2.6 telemetry, T2.9 router-on eval) and T2.3 timeout/abort: a separate flip, a separate slice.
- Defense-in-depth prompt-level minor handling in `SKILL.md` (would move the conversation eval): noted as a future slice. This slice keeps minors at the deterministic layer.
- Floor-suppression observability (the hook does not persist "allow" verdicts today; adding that is an architectural change).
- Matcher-level compound-sentence negation precision (the documented T1.2b limitation).

## 6. Acceptance criteria

1. The confidence floor **actually gates** the classifier decision (a sub-threshold non-`none` classification yields allow), proven by a hook-level live-path test, not stored-and-ignored.
2. Bare-anxiety, self-negated-condition, third-party-condition, and paraphrased-approved-claim over-escalations are narrowed **without** loosening the 4 locked red flags.
3. A self-disclosed minor escalates through the real pre-input gate (enforce mode), via a precise trigger that does not false-fire on "16 years of experience"-style text.
4. Coverage added at the live escalation layer plus a deterministic-gate integration test; red-team-verified (including `/codex:adversarial-review`) to actually bite.
5. Full local gate green (`build`, `typecheck`, `test`, `format:check`, `lint`, plus eval typechecks), noting pre-existing flakes (gateway-bridge-attribution, pg_advisory) and the infra-RED classifier eval.
6. PR to `main` (squash), **no auto-merge**.
