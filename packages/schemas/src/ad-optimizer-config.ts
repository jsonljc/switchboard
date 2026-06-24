import { z } from "zod";

/**
 * Maps "empty-ish" inputs to undefined so the wrapped schema's `.default()`
 * fires instead of `z.coerce.number()` silently producing `0`. Specifically:
 * `""`, `"  "` (whitespace), `null`, `undefined`. `false` / `[]` and other
 * non-string falsy values fall through to the inner schema, where coercion
 * (and `.nonnegative()`) decides their fate — typically rejecting them.
 *
 * Needed because operator-form values land in inputConfig as strings (the
 * marketplace listing form declares these fields as `type: "text"`), and a
 * cleared form field comes through as `""`. Without this preprocess,
 * `z.coerce.number("")` is `0` and the `.default(N)` never runs.
 */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

const numericWithDefault = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().default(fallback));

/**
 * Like numericWithDefault but with NO default: an unset value stays `undefined`.
 * For optional economic targets (e.g. targetCostPerBooked) where "unset" is a real,
 * meaningful state (no booked-CAC tier) that must never collapse to a silent 0.
 * Still coerces operator string input to a number and rejects malformed text
 * (e.g. "$1,500" -> NaN -> .nonnegative() throws) rather than NaN-suppressing.
 */
const numericOptional = () =>
  z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().optional());

/**
 * Per-deployment ad-optimizer config. Lives at the top level of
 * AgentDeployment.inputConfig (e.g. inputConfig.targetCPA), not nested
 * under inputConfig.adOptimizer — top-level placement matches the existing
 * inngest cron readers in packages/ad-optimizer. The inputConfig column is
 * shaped as `z.record(z.unknown())` on the marketplace schema side, so
 * this typed overlay is opt-in: callers run resolveAdOptimizerConfig(inputConfig)
 * to read the fields with defaults filled.
 *
 * Each numeric field is wrapped in `numericWithDefault(N)` (preprocess →
 * coerce → nonnegative → default). The preprocess strips empty/null/
 * whitespace inputs so cleared form values fall back to the default
 * instead of silently coercing to `0`. The marketplace listing form
 * (`packages/db/prisma/seed-marketplace.ts`) declares these fields as
 * `type: "text"`, so operator-entered values arrive as strings; coercion
 * normalizes them to the number shape that downstream consumers
 * (inngest crons, dashboard, the LLM prompt template) expect.
 *
 * `.passthrough()` keeps any non-schema keys in the result so the parsed
 * bag can flow into DEPLOYMENT_CONFIG for the ad-optimizer LLM prompt
 * without losing operator-supplied extras (e.g. pixelId, auditFrequency).
 *
 * Defaults match the inngest weekly-audit fallbacks: targetCPA=100,
 * targetROAS=3. monthlyBudget defaults to 0 ("not set") for parity with
 * the historical untyped read.
 */
export const AdOptimizerConfigSchema = z
  .object({
    targetCPA: numericWithDefault(100),
    targetROAS: numericWithDefault(3),
    monthlyBudget: numericWithDefault(0),
    // A21: the booked-CAC target. No default — unset means "no booked_cac tier",
    // a real state the weekly-audit cron reads with a `typeof === "number"` guard.
    targetCostPerBooked: numericOptional(),
  })
  .passthrough()
  .default({});

export type AdOptimizerConfig = z.infer<typeof AdOptimizerConfigSchema>;

export function resolveAdOptimizerConfig(
  inputConfig: Record<string, unknown> | null | undefined,
): AdOptimizerConfig {
  return AdOptimizerConfigSchema.parse(inputConfig ?? {});
}
