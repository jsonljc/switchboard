import { z } from "zod";

/**
 * Canonical-key format: `<namespace>:<subkey>`, lowercase, underscores only.
 * Examples: `objection:downtime_work`, `scheduling:availability`.
 *
 * This is a STRUCTURAL refinement. Enum-membership is checked separately by
 * isKnownCanonicalKey() because each deployment vertical seeds its own enum
 * (medspa launches with the constant below; other verticals come later).
 */
export const CANONICAL_KEY_PATTERN = /^[a-z_]+:[a-z0-9_]+$/;

export const CanonicalKeySchema = z.string().regex(CANONICAL_KEY_PATTERN, {
  message: "canonical key must match ^[a-z_]+:[a-z0-9_]+$",
});

export type CanonicalKey = z.infer<typeof CanonicalKeySchema>;

/**
 * Medspa pilot enum — intentionally narrow at launch. Splitting downtime/
 * redness/aftercare reduces forced over-merge inside any single bucket.
 * Operators expand the enum after reviewing the rejection queue.
 */
export const MEDSPA_CANONICAL_KEYS = [
  "objection:downtime_work",
  "objection:redness_side_effects",
  "objection:aftercare_restrictions",
  "objection:pain",
  "objection:price_value",
  "objection:results_proof",
  "objection:safety_credentials",
  "scheduling:availability",
  "scheduling:location_access",
] as const;

export type MedspaCanonicalKey = (typeof MEDSPA_CANONICAL_KEYS)[number];

export function isKnownCanonicalKey(candidate: string, enumeration: readonly string[]): boolean {
  return enumeration.includes(candidate);
}
