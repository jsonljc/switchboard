import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  compareSources,
  decideSourceReallocation,
  computeAuditEconomicsSections,
} from "@switchboard/ad-optimizer";
import type { SourceFunnel } from "@switchboard/ad-optimizer";
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";

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
  /** Account-wide evidence for the scale floor. IGNORED on the activated (campaigns+adSetData)
   * path, where the orchestrator derives it from `campaigns` clicks/conversions. */
  accountEvidence: z.object({
    clicks: z.number(),
    conversions: z.number(),
    days: z.number(),
  }),
  /** Phase-A Gate 1: false models a suspected account-wide step-change. Omit ⇒ trusted. */
  measurementTrusted: z.boolean().optional(),
  /** False ⇒ per-source spend is the lead-share fallback (no ad-set attribution). Omit ⇒ trusted.
   * Legacy path only — IGNORED when `adSetData` is present (coverage is derived for real). */
  spendAttributionTrusted: z.boolean().optional(),
  /** Activated path: per-campaign spend + evidence. When present with `adSetData`, the harness
   * drives the REAL `computeAuditEconomicsSections` (attribution → coverage → gate) instead of
   * passing a spendAttributionTrusted boolean. */
  campaigns: z
    .array(
      z.object({
        campaignId: z.string(),
        spend: z.number(),
        inlineLinkClicks: z.number(),
        conversions: z.number(),
      }),
    )
    .optional(),
  /** Activated path: per-ad-set destination + spend, attributed by destinationTypeToSource. */
  adSetData: z
    .array(
      z.object({
        adSetId: z.string(),
        campaignId: z.string(),
        spend: z.number(),
        destinationType: z.string(),
      }),
    )
    .optional(),
  expectedOutcome: z.enum(["shift_budget_to_source", "watch", "none"]),
  expectedWatchPattern: z.enum(["measurement_untrusted", "insufficient_evidence"]).optional(),
  notes: z.string().optional(),
});
export type SourceReallocationCase = z.infer<typeof SourceReallocationCaseSchema>;

export interface SourceReallocationDecision {
  outcome: "shift_budget_to_source" | "watch" | "none";
  watchPattern?: string;
}

/** Minimal CampaignInsight the orchestrator reads (campaignId/spend for attribution +
 * inlineLinkClicks/conversions for the derived account-evidence floor); the rest is padding. */
function buildInsight(c: {
  campaignId: string;
  spend: number;
  inlineLinkClicks: number;
  conversions: number;
}): CampaignInsight {
  return {
    campaignId: c.campaignId,
    campaignName: c.campaignId,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 0,
    inlineLinkClicks: c.inlineLinkClicks,
    spend: c.spend,
    conversions: c.conversions,
    revenue: 0,
    frequency: 0,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
  };
}

function buildAdSet(a: {
  adSetId: string;
  campaignId: string;
  spend: number;
  destinationType: string;
}): AdSetLearningInput {
  return {
    adSetId: a.adSetId,
    adSetName: a.adSetId,
    campaignId: a.campaignId,
    learningStageStatus: "UNKNOWN",
    frequency: 0,
    spend: a.spend,
    conversions: 0,
    cpa: 0,
    roas: 0,
    inlineLinkClickCtr: 0,
    destinationType: a.destinationType,
  };
}

/**
 * Resolve a fixture case through the REAL Riley decision seam. The engine is the source of
 * truth; this never re-implements the decision.
 *   - Activated path (campaigns + adSetData): drives `computeAuditEconomicsSections`, the SAME
 *     orchestrator the weekly cron uses — exercising real attribution → coverage → gate (so the
 *     coverage floor is never hand-copied here and can't drift from production).
 *   - Legacy path: per-source spend supplied directly, gate passed as a boolean.
 * Deterministic, model-free, DB-free.
 */
export async function decideSourceReallocationForCase(
  c: SourceReallocationCase,
): Promise<SourceReallocationDecision> {
  const bySource: Record<string, SourceFunnel> = {};
  for (const s of c.sources) {
    bySource[s.source] = {
      received: s.received,
      qualified: s.qualified,
      booked: s.booked,
      showed: 0,
      paid: s.paid,
      revenue: s.revenueCents,
    };
  }

  if (c.adSetData && c.campaigns) {
    const { reallocation } = await computeAuditEconomicsSections({
      bySource,
      byCampaign: undefined,
      currentInsights: c.campaigns.map(buildInsight),
      adSetData: c.adSetData.map(buildAdSet),
      measurementTrusted: c.measurementTrusted ?? true,
      nextCycleDate: "2026-05-14",
      orgId: "eval",
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
    });
    if (reallocation === null) return { outcome: "none" };
    if (reallocation.type === "watch") {
      return { outcome: "watch", watchPattern: reallocation.pattern };
    }
    return { outcome: "shift_budget_to_source" };
  }

  const spendBySource: Record<string, number> = {};
  for (const s of c.sources) spendBySource[s.source] = s.spend;
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
