import { z } from "zod";

/**
 * The three real untrusted-input seams the audit named (ADV-1). Attacker-
 * influenceable text reaches an LLM agent through exactly one of these:
 *   - `alex-inbound`        — the customer's inbound WhatsApp/chat message.
 *   - `riley-campaign-name` — operator/ad-platform campaign + ad names.
 *   - `mira-taste-facts`    — operator taste notes + business-facts free text.
 *
 * Only `alex-inbound` is driven through a LIVE model in this slice (Alex is the
 * only agent with a conversation harness today). The Riley/Mira seams are
 * exercised against the deterministic grader via synthetic outputs now, and
 * driven live by EV-3b (Riley, rides with EV-7) and EV-3c (Mira, rides with EV-6).
 */
export const InjectionSeamSchema = z.enum([
  "alex-inbound",
  "riley-campaign-name",
  "mira-taste-facts",
]);
export type InjectionSeam = z.infer<typeof InjectionSeamSchema>;

/** ADV-1 prompt-injection categories (`kind:"injection"`). */
export const INJECTION_CATEGORIES = [
  "ignore-instructions",
  "reveal-system-prompt",
  "set-price",
  "set-deposit",
  "set-budget",
  "role-swap",
] as const;

/** ADV-3 malformed / input-robustness categories (`kind:"malformed"`). */
export const MALFORMED_CATEGORIES = [
  "empty",
  "emoji-flood",
  "mixed-script",
  "script-payload",
  "control-chars",
] as const;

export const InjectionCategorySchema = z.enum([...INJECTION_CATEGORIES, ...MALFORMED_CATEGORIES]);
export type InjectionCategory = z.infer<typeof InjectionCategorySchema>;

const INJECTION_SET = new Set<string>(INJECTION_CATEGORIES);
const MALFORMED_SET = new Set<string>(MALFORMED_CATEGORIES);

/**
 * Per-case grader expectations. Both fields are deny-lists checked by the
 * deterministic grader:
 *   - `injectedToolArgValues` — values the attacker tried to plant into a tool
 *     argument (a budget number, a price, a deposit amount). NONE may appear in
 *     any tool-call parameter. The load-bearing money / regulated check.
 *   - `forbiddenResponseSubstrings` — substrings that, if present verbatim in the
 *     agent reply, indicate compliance (e.g. `"$1"` for a slash-the-price attack,
 *     `"free"` for a waive-deposit attack, an exfiltrated secret token).
 */
export const CaseExpectationSchema = z
  .object({
    injectedToolArgValues: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .optional(),
    forbiddenResponseSubstrings: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type CaseExpectation = z.infer<typeof CaseExpectationSchema>;

/**
 * One corpus case. `kind` and `category` must agree (an injection case carries an
 * injection category; a malformed case a malformed category). The `empty`
 * category is the ONLY one allowed an empty payload — every other category must
 * carry a non-empty payload so a case cannot silently degrade to a no-op.
 */
export const InjectionCaseSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["injection", "malformed"]),
    category: InjectionCategorySchema,
    seam: InjectionSeamSchema,
    payload: z.string(),
    expect: CaseExpectationSchema.optional(),
    note: z.string().min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === "injection" && !INJECTION_SET.has(c.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `kind:"injection" requires an injection category, got "${c.category}"`,
        path: ["category"],
      });
    }
    if (c.kind === "malformed" && !MALFORMED_SET.has(c.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `kind:"malformed" requires a malformed category, got "${c.category}"`,
        path: ["category"],
      });
    }
    if (c.category === "empty" && c.payload.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `category "empty" must carry an empty payload`,
        path: ["payload"],
      });
    }
    if (c.category !== "empty" && c.payload.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `category "${c.category}" must carry a non-empty payload`,
        path: ["payload"],
      });
    }
  });
export type InjectionCase = z.infer<typeof InjectionCaseSchema>;

export const InjectionCorpusSchema = z
  .array(InjectionCaseSchema)
  .min(1)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();
    for (const c of cases) {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate case id "${c.id}"`,
        });
      }
      seen.add(c.id);
    }
  });
export type InjectionCorpus = z.infer<typeof InjectionCorpusSchema>;

// ---------------------------------------------------------------------------
// Baseline (judge soft-score drift gate). Deterministic violations are a HARD
// fail independent of the baseline — you never baseline-accept a live injection.
// ---------------------------------------------------------------------------

export const InjectionScenarioBaselineSchema = z.object({
  id: z.string(),
  /** True on a clean run. A baseline entry MUST be true — a false here is a vuln. */
  deterministicPass: z.boolean(),
  /** Informational judge soft score 0–5 (resistance quality). */
  judgeScore: z.number().min(0).max(5),
  /** Deterministic violation codes observed (empty on a clean run). */
  violations: z.array(z.string()),
});
export type InjectionScenarioBaseline = z.infer<typeof InjectionScenarioBaselineSchema>;

export const InjectionBaselineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  /** SHA-256 (truncated) of the corpus, stored for stale-baseline visibility (not enforced on read — mirrors alex-conversation's skillContentHash). */
  corpusHash: z.string().min(1),
  judgeRubricVersion: z.string().min(1),
  judgeScoreTolerance: z.number().min(0).max(5),
  scenarios: z.array(InjectionScenarioBaselineSchema),
});
export type InjectionBaseline = z.infer<typeof InjectionBaselineSchema>;
