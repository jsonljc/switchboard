import { SURFACING_THRESHOLD } from "@switchboard/schemas";
import type { CreativeMemoryProvider } from "@switchboard/creative-pipeline";

/** The DeploymentMemory subset the provider reads (tests inject a mock). */
export interface TasteContextMemoryReader {
  listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ): Promise<
    Array<{
      id: string;
      category: string;
      canonicalKey: string | null;
      sourceCount: number;
      confidence: number;
    }>
  >;
}

const TASTE_KEY = /^taste:(kept|passed)_(polished|ugc)_([a-z0-9_]+)$/;

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question hooks",
  bold_statement: "bold-statement hooks",
  none: "creatives with no leading hook",
};

function renderLine(decision: string, mode: string, hookType: string, sourceCount: number): string {
  const verb = decision === "kept" ? "keeps" : "passes";
  const noun = decision === "kept" ? "keeps" : "passes";
  const what = HOOK_PHRASE[hookType] ?? `${hookType} hooks`;
  return `consistently ${verb} ${what} in ${mode} mode (${sourceCount} ${noun})`;
}

/**
 * apps/api implementation of the L2 CreativeMemoryProvider seam (spec 3.8):
 * high-confidence taste buckets (standard surfacing thresholds: 0.66
 * confidence, 3 sources) rendered as clearly-subjective lines for the trend
 * and hook prompts. Rows whose canonicalKey does not parse as a taste bucket
 * contribute nothing (parse-don't-cast).
 */
export function buildCreativeTasteProvider(
  memoryStore: TasteContextMemoryReader,
): CreativeMemoryProvider {
  return {
    async getTasteContext(organizationId: string, deploymentId: string): Promise<string[]> {
      const rows = await memoryStore.listHighConfidence(
        organizationId,
        deploymentId,
        SURFACING_THRESHOLD.minConfidence,
        SURFACING_THRESHOLD.minSourceCount,
      );
      const lines: string[] = [];
      for (const row of rows) {
        if (row.category !== "taste" || !row.canonicalKey) continue;
        const m = TASTE_KEY.exec(row.canonicalKey);
        if (!m) continue;
        lines.push(renderLine(m[1]!, m[2]!, m[3]!, row.sourceCount));
      }
      return lines;
    },
  };
}
