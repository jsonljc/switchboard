/**
 * Vertical axis for the governance loaders (banned phrases, escalation triggers)
 * and the recommendation urgency scorer.
 *
 * `medspa` is the seed (reference-tenant) vertical: those subsystems key on it so
 * a later vertical pack can layer its own tables / LTV band without a call-site
 * change. Kept as a LOCAL core type (deliberately NOT an L1 schema union) so
 * this seam stays additive and fully reversible until the VerticalPack registry
 * lands. The vocabulary mirrors the schemas `reference-metadata` vertical enum
 * (minus "none", which never carries governance data).
 */
export type Vertical = "medspa" | "dental" | "fitness" | "generic";

/**
 * Default vertical. Every existing caller keys on this, so re-keying the loaders
 * and the scorer on (vertical, jurisdiction) leaves medspa behavior byte-identical.
 */
export const DEFAULT_VERTICAL: Vertical = "medspa";

/**
 * Resolve a vertical's table from a `_BY_VERTICAL` map with a fail-CLOSED
 * fallback. A registered, NON-EMPTY table resolves verbatim; an absent OR empty
 * (`[]`) table falls back to `floor`.
 *
 * The length check (not `??`) is load-bearing: `byVertical[v] ?? floor` only
 * falls back on `undefined`, so a pack registering an empty array (`[] `) would
 * resolve to the empty set and silently DROP the floor. Checking `length > 0`
 * closes that empty-array fail-open, so the safe direction is always the floor,
 * never nothing.
 */
export function resolveVerticalTable<T>(
  byVertical: Partial<Record<Vertical, ReadonlyArray<T>>>,
  vertical: Vertical,
  floor: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const table = byVertical[vertical];
  return table && table.length > 0 ? table : floor;
}
