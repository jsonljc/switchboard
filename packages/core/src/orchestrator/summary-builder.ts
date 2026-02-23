/**
 * Builds human-readable summaries for action proposals.
 * Used in approval requests and audit entries instead of raw JSON.
 */

const ACTION_TEMPLATES: Record<string, (params: Record<string, unknown>) => string> = {
  "ads.campaign.pause": (p) =>
    `Pause campaign "${p["campaignName"] ?? p["campaignId"] ?? "unknown"}"`,

  "ads.campaign.resume": (p) =>
    `Resume campaign "${p["campaignName"] ?? p["campaignId"] ?? "unknown"}"`,

  "ads.budget.adjust": (p) => {
    const campaign = p["campaignName"] ?? p["campaignId"] ?? "unknown";
    const amount = p["amount"] ?? p["newBudget"];
    const direction = p["direction"] ?? (Number(amount) > 0 ? "increase" : "decrease");
    return `Adjust budget for "${campaign}" — ${direction} by $${Math.abs(Number(amount) || 0)}`;
  },
};

export function buildActionSummary(
  actionType: string,
  parameters: Record<string, unknown>,
  principalId?: string,
): string {
  const template = ACTION_TEMPLATES[actionType];
  if (template) {
    const base = template(parameters);
    return principalId ? `${base} (requested by ${principalId})` : base;
  }

  // Fallback: produce a readable summary from the action type
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
