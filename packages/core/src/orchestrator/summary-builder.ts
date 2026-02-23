/**
 * Builds human-readable summaries for action proposals.
 * Used in approval requests and audit entries instead of raw JSON.
 *
 * Summary generation is now fully generic — no cartridge-specific templates.
 * Cartridges that need custom summaries should implement enrichContext()
 * to provide descriptive metadata fields.
 */

export function buildActionSummary(
  actionType: string,
  parameters: Record<string, unknown>,
  principalId?: string,
): string {
  // Produce a readable summary from the action type
  const readable = actionType.replace(/\./g, " › ");
  const paramKeys = Object.keys(parameters).filter((k) => !k.startsWith("_"));
  if (paramKeys.length === 0) {
    return principalId ? `${readable} (requested by ${principalId})` : readable;
  }

  const paramSummary = paramKeys
    .slice(0, 4)
    .map((k) => `${k}=${summarizeValue(parameters[k])}`)
    .join(", ");

  const base = `${readable} (${paramSummary})`;
  return principalId ? `${base} — requested by ${principalId}` : base;
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 40 ? value.slice(0, 37) + "..." : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "[object]";
}
