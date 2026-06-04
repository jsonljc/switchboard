// packages/creative-pipeline/src/stages/prompt-blocks.ts
import type { CreativePerformanceHistory } from "@switchboard/schemas";

/**
 * Measured channel (slice-2 spec 3.8): numbers, source-labeled, rendered only
 * when attributed history exists. Never merged with the taste block; channel
 * separation is enforced by shape.
 */
export function renderPastPerformanceBlock(
  history: CreativePerformanceHistory | null | undefined,
): string {
  if (!history || history.topPerformers.length === 0) return "";
  const lines = history.topPerformers.map((p) => {
    const roas = p.trueRoas !== null ? `${p.trueRoas.toFixed(1)}x trueROAS` : "trueROAS unknown";
    return `- ${p.descriptor}: ${roas}, $${p.spend.toFixed(2)} spent, $${(
      p.bookedValueCents / 100
    ).toFixed(2)} booked`;
  });
  return `\n\n**PAST PERFORMANCE (measured):**\n${lines.join("\n")}\n${history.summary}`;
}

/**
 * Taste channel (slice-2 spec 3.8): the operator's Keep/Pass gestures, under a
 * clearly subjective heading, never numbers. Empty input renders nothing
 * (degrade-gracefully, dev parity).
 */
export function renderTasteBlock(tasteContext: string[] | undefined): string {
  if (!tasteContext || tasteContext.length === 0) return "";
  return `\n\n**OPERATOR TASTE (subjective, from review gestures):**\n${tasteContext
    .map((l) => `- ${l}`)
    .join("\n")}`;
}
