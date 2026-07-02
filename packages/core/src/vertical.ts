/**
 * Vertical axis for the governance loaders (banned phrases, escalation triggers)
 * and the recommendation urgency scorer.
 *
 * `medspa` is the seed (reference-tenant) vertical: those subsystems key on it so
 * a later vertical pack can layer its own tables / LTV band without a call-site
 * change. Promoted to an L1 schema union (L1 S2-2) so the regulatory-profile
 * registry can type `loaderVertical` without a layer violation; re-exported here
 * so every existing core importer of `../vertical.js` resolves unchanged. The
 * vocabulary mirrors the schemas `reference-metadata` vertical enum (minus
 * "none", which never carries governance data).
 *
 * Single source: the type derives from VERTICALS so the runtime list (used by
 * resolveVertical's marker validation) and the union can never drift apart.
 */
export { VERTICALS, DEFAULT_VERTICAL } from "@switchboard/schemas";
export type { Vertical } from "@switchboard/schemas";
import type { Vertical } from "@switchboard/schemas";

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
