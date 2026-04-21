// apps/dashboard/src/lib/interview-parsers.ts

const NAME_PREFIXES = /^(we're|i'm|it's|we are|i am|this is|my business is|it is)\s+/i;

export function parseBusinessIdentityResponse(text: string): { name: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstPhrase = trimmed.split(",")[0].replace(NAME_PREFIXES, "").trim();
  return firstPhrase ? { name: firstPhrase } : null;
}

export function parseServicesResponse(
  text: string,
): Array<{ name: string; price?: number }> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/[,;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  return lines
    .map((line) => {
      const priceMatch = line.match(/\$(\d+(?:\.\d{2})?)/);
      const name = line
        .replace(/\$\d+(?:\.\d{2})?/, "")
        .replace(/[-–—]\s*$/, "")
        .trim();
      if (!name) return null;
      return { name, ...(priceMatch ? { price: parseFloat(priceMatch[1]) } : {}) };
    })
    .filter((s): s is { name: string; price?: number } => s !== null);
}

export function parseHoursResponse(text: string): { schedule: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { schedule: trimmed };
}

export function parseEscalationTriggers(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const triggers = trimmed
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return triggers.length > 0 ? triggers : null;
}
