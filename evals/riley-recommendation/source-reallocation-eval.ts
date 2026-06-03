import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compareSources, decideSourceReallocation } from "@switchboard/ad-optimizer";
import type { SourceFunnel } from "@switchboard/ad-optimizer";

/**
 * One deterministic Riley source-reallocation case. Inputs are per-source funnel
 * counts + spend (the harness builds the SourceFunnel + spendBySource and runs them
 * through the REAL `compareSources` -> `decideSourceReallocation` seam — the engine
 * is the source of truth; this never re-implements the decision). expectedOutcome is
 * the reduced label the harness asserts.
 */
export const SourceReallocationCaseSchema = z.object({
  id: z.string().min(1),
  sources: z.array(
    z.object({
      source: z.string(),
      received: z.number(),
      qualified: z.number(),
      booked: z.number(),
      paid: z.number(),
      /** SourceFunnel.revenue is CENTS — the trueROAS numerator (normalized cents->major). */
      revenueCents: z.number(),
      /** Dollars (major). */
      spend: z.number(),
    }),
  ),
  accountEvidence: z.object({
    clicks: z.number(),
    conversions: z.number(),
    days: z.number(),
  }),
  /** Phase-A Gate 1: false models a suspected account-wide step-change. Omit ⇒ trusted. */
  measurementTrusted: z.boolean().optional(),
  /** False ⇒ per-source spend is the lead-share fallback (no ad-set attribution). Omit ⇒ trusted. */
  spendAttributionTrusted: z.boolean().optional(),
  expectedOutcome: z.enum(["shift_budget_to_source", "watch", "none"]),
  expectedWatchPattern: z.enum(["measurement_untrusted", "insufficient_evidence"]).optional(),
  notes: z.string().optional(),
});
export type SourceReallocationCase = z.infer<typeof SourceReallocationCaseSchema>;

export interface SourceReallocationDecision {
  outcome: "shift_budget_to_source" | "watch" | "none";
  watchPattern?: string;
}

/**
 * Resolve a fixture case through the REAL `compareSources` + `decideSourceReallocation`
 * pipeline. Deterministic, model-free, DB-free.
 */
export function decideSourceReallocationForCase(
  c: SourceReallocationCase,
): SourceReallocationDecision {
  const bySource: Record<string, SourceFunnel> = {};
  const spendBySource: Record<string, number> = {};
  for (const s of c.sources) {
    bySource[s.source] = {
      received: s.received,
      qualified: s.qualified,
      booked: s.booked,
      showed: 0,
      paid: s.paid,
      revenue: s.revenueCents,
    };
    spendBySource[s.source] = s.spend;
  }
  const sourceComparison = compareSources({ bySource, spendBySource });
  const result = decideSourceReallocation({
    sourceComparison,
    bySource,
    accountEvidence: c.accountEvidence,
    spendAttributionTrusted: c.spendAttributionTrusted ?? true,
    measurementTrusted: c.measurementTrusted ?? true,
    nextCycleDate: "2026-05-14",
  });
  if (result === null) return { outcome: "none" };
  if (result.type === "watch") return { outcome: "watch", watchPattern: result.pattern };
  return { outcome: "shift_budget_to_source" };
}

/**
 * Load every `*.jsonl` source-reallocation case directly under `dir` (no recursion).
 * Mirrors `load-fixtures.ts`: one JSON object per line, `#`/blank lines skipped,
 * duplicate ids rejected. Lives under a `source-reallocation/` subdir so the
 * per-campaign `loadRileyCases` (which reads only the top-level fixtures dir) ignores it.
 */
export function loadSourceReallocationCases(dir: string): SourceReallocationCase[] {
  const rows: SourceReallocationCase[] = [];
  const seen = new Set<string>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const lines = readFileSync(join(dir, file), "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (e) {
        throw new Error(`${file}:${i + 1} — invalid JSON: ${(e as Error).message}`);
      }
      const parsed = SourceReallocationCaseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}:${i + 1} — schema violation: ${parsed.error.message}`);
      }
      if (seen.has(parsed.data.id)) {
        throw new Error(`duplicate case id: ${parsed.data.id}`);
      }
      seen.add(parsed.data.id);
      rows.push(parsed.data);
    }
  }
  return rows;
}
