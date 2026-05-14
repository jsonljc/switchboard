/**
 * Returns the list of top-level keys whose JSON-serialised value differs
 * between `before` and `after`. Used to highlight changed parameters in
 * the patch editor diff pane.
 */
export function jsonDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}
