import type { PolicyRule } from "@switchboard/schemas";

/** Positive matchers: operators whose presence MEANS "this rule targets this
 * actionType". Negative/comparison operators (neq, not_in, exists, ...) do not
 * name an action the rule governs, so they are excluded from the orphan check. */
const POSITIVE_ACTION_TYPE_OPERATORS = new Set(["matches", "eq", "in"]);

/**
 * Collect the raw `actionType` matcher strings a policy rule targets, walking the
 * rule's own conditions and recursing into nested `children`. Used by the policies
 * DELETE-route orphan guard (D5-2b) to decide whether deleting a require_approval
 * policy would leave a matching `allow` policy ungated.
 *
 * Comparison is on the RAW matcher string (the seeded pause/handoff pairs share a
 * byte-identical regex), so a different regex spelling for the same action is out
 * of scope by design. `in`/`not_in` array values are flattened to their string
 * members; non-string values are skipped.
 */
export function extractActionTypeMatchers(rule: PolicyRule): string[] {
  const out: string[] = [];
  const walk = (r: PolicyRule): void => {
    for (const condition of r.conditions ?? []) {
      if (condition.field !== "actionType") continue;
      if (!POSITIVE_ACTION_TYPE_OPERATORS.has(condition.operator)) continue;
      if (typeof condition.value === "string") {
        out.push(condition.value);
      } else if (Array.isArray(condition.value)) {
        for (const v of condition.value) if (typeof v === "string") out.push(v);
      }
    }
    for (const child of r.children ?? []) walk(child);
  };
  walk(rule);
  return out;
}
