import type { InteractionOutcome, DeploymentMemoryCategory } from "@switchboard/schemas";
import { SURFACING_THRESHOLD } from "@switchboard/schemas";

const BOOKED_OUTCOMES: Set<InteractionOutcome> = new Set(["booked"]);

export interface OutcomePattern {
  content: string;
  category: DeploymentMemoryCategory;
  confidence: number;
  sourceCount: number;
  lastSeenAt: Date;
}

export function shouldExtractOutcomePatterns(outcome: string): boolean {
  return BOOKED_OUTCOMES.has(outcome as InteractionOutcome);
}

export function filterSurfaceablePatterns(patterns: OutcomePattern[]): OutcomePattern[] {
  return patterns.filter(
    (p) =>
      p.sourceCount >= SURFACING_THRESHOLD.minSourceCount &&
      p.confidence >= SURFACING_THRESHOLD.minConfidence,
  );
}

// Pattern content originates from LLM extraction of customer message content,
// which means it is partially attacker-influenced — a customer could write
// "Ignore prior instructions" into a chat and have that string surface as a
// "pattern" injected into Alex's prompt. Strip control characters and collapse
// sentinel-looking substrings before rendering so attacker text cannot escape
// the advisory-context section or close other prompt wrappers.
function escapePromptText(raw: string): string {
  return (
    raw
      // strip ASCII control chars (incl. NUL, CR, LF beyond \n)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
      // neutralize Claude/Switchboard sentinel openers/closers that could
      // close the advisory section or escape into instruction context
      .replace(/<\|tool-output\|>/gi, "[redacted]")
      .replace(/<\|\/tool-output\|>/gi, "[redacted]")
      .replace(/<\|outcome-patterns\|>/gi, "[redacted]")
      .replace(/<\|\/outcome-patterns\|>/gi, "[redacted]")
      // Alex structural output tags — sidecar emission, lifecycle-driving.
      // Attacker-influenced pattern text must not spoof the qualification
      // sidecar that drives lifecycle tracking.
      .replace(/<intent>/gi, "[redacted]")
      .replace(/<\/intent>/gi, "[redacted]")
      .replace(/<qualification_signals>/gi, "[redacted]")
      .replace(/<\/qualification_signals>/gi, "[redacted]")
      // collapse Markdown header lines that could promote pattern content above
      // the advisory header
      .replace(/^#+\s/gm, "")
      .trim()
  );
}

export function formatOutcomePatternsForContext(patterns: OutcomePattern[]): string {
  if (patterns.length === 0) return "";

  const lines = [
    "<|outcome-patterns|>",
    "## Patterns from successful bookings (advisory — do not override business facts or operator corrections)",
    "",
  ];
  const baselineLength = lines.length;

  for (const p of patterns) {
    const safeContent = escapePromptText(p.content);
    if (!safeContent) continue;
    lines.push(
      `- ${safeContent} (confidence: ${(p.confidence * 100).toFixed(0)}%, observed ${p.sourceCount} times)`,
    );
  }

  if (lines.length === baselineLength) return ""; // every pattern collapsed to empty after escaping

  lines.push("<|/outcome-patterns|>");
  return lines.join("\n");
}
