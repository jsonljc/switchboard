import {
  arbitrate,
  assembleRevenueState,
  generateSignalHealthRecommendations,
} from "@switchboard/ad-optimizer";
import type { SignalHealthReport, Breach } from "@switchboard/ad-optimizer";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RileyCaseSchema } from "./schema.js";
import { decideRawForCase } from "./decide.js";

/**
 * Riley v3 slice 2 arbitration sub-eval. The per-campaign harness is structurally
 * blind to a cross-campaign selection (spec 7.1), so the arbitrator brings its own
 * pin: multi-campaign accounts resolved through the REAL producers
 * (decideForCampaign per campaign + generateSignalHealthRecommendations for
 * breaches) and the REAL arbitrate(); nothing here re-implements decision logic.
 */

/** One campaign inside a multi-campaign arbitration account: a standard riley case
 * body (decision-relevant fields only) plus the campaign identity. */
const ArbitrationCampaignSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string().optional(),
  case: RileyCaseSchema.omit({
    id: true,
    expectedOutcome: true,
    expectedActions: true,
    expectedWatchPatterns: true,
    expectedTargetSource: true,
    notes: true,
  }),
});

export const ArbitrationCaseSchema = z.object({
  id: z.string(),
  /** Account-level RevenueState inputs (revenueProximity reads the ACCOUNT tier). */
  accountEconomicTier: z.enum(["booked_cac", "cpl", "cpc"]),
  accountEffectiveTarget: z.number(),
  accountMeasurementTrusted: z.boolean().optional(),
  /** Optional REAL measurement-fix producer input (generateSignalHealthRecommendations).
   * Signals are the remediable subset (da_check_failed has a null remediation). */
  signalBreaches: z
    .array(
      z.object({
        signal: z.enum(["pixel_dead", "server_to_browser_low", "dedup_low", "freshness_stale"]),
        severity: z.enum(["critical", "warning"]),
        message: z.string(),
      }),
    )
    .optional(),
  campaigns: z.array(ArbitrationCampaignSchema).min(1),
  /** The single selected primary, or null when the cycle must produce none. */
  expectedPrimary: z.object({ campaignId: z.string(), action: z.string() }).nullable(),
  /** Set-membership over secondary actions (mirrors the expectedActions convention). */
  expectedSecondaryActions: z.array(z.string()).optional(),
  expectedMeasurementFixAction: z.string().optional(),
  notes: z.string().optional(),
});
export type ArbitrationCase = z.infer<typeof ArbitrationCaseSchema>;

export interface ArbitrationDecision {
  primary: { campaignId: string; action: string } | null;
  secondaryActions: string[];
  measurementFixAction?: string;
}

/** Load every `*.jsonl` arbitration case directly under `dir` (no recursion).
 * Mirrors load-fixtures.ts: one JSON object per line, `#` comments and blank
 * lines skipped, duplicate ids rejected. */
export function loadArbitrationCases(dir: string): ArbitrationCase[] {
  const rows: ArbitrationCase[] = [];
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
      const parsed = ArbitrationCaseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}:${i + 1} — schema violation: ${parsed.error.message}`);
      }
      if (seen.has(parsed.data.id)) throw new Error(`duplicate case id: ${parsed.data.id}`);
      seen.add(parsed.data.id);
      rows.push(parsed.data);
    }
  }
  return rows;
}

/** Minimal healthy report wrapper: generateSignalHealthRecommendations reads only
 * `breaches`, but the type requires the full shape (mirrors the abort-guard fixture). */
function makeSignalReport(breaches: Breach[]): SignalHealthReport {
  return {
    pixelId: "px_eval",
    score: breaches.some((b) => b.severity === "critical") ? "red" : "yellow",
    pixelHealth: {
      pixelId: "px_eval",
      name: "Eval pixel",
      lastFiredAt: "2026-05-07T00:00:00.000Z",
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: false,
    },
    eventVolume: { events: [] },
    capiHealth: {
      serverToBrowserRatio: 0.95,
      dedupRate: 0.85,
      lastServerEventAt: "2026-05-07T00:00:00.000Z",
      freshnessMs: 60_000,
      isFresh: true,
    },
    daChecks: { checks: [], hasFailure: false },
    emqProxy: 0.8,
    breaches,
  };
}

/**
 * Drive the REAL producers and the REAL arbitrate(). Candidate order mirrors the
 * audit-runner: per-campaign recs in campaign order, then signal-health recs.
 */
export function runArbitrationCase(c: ArbitrationCase): ArbitrationDecision {
  const candidates: RecommendationOutput[] = [];
  const currentInsights: { campaignId: string; spend: number }[] = [];
  // Value-ranking: thread the per-campaign paid value (the same paidValueGate the scale gate
  // uses) into the arbitrator so a scale money-move ranks by proven paid value, not spend share.
  const paidValueByCampaign = new Map<string, number>();
  for (const entry of c.campaigns) {
    const raw = decideRawForCase(
      entry.case,
      entry.campaignId,
      entry.campaignName ?? entry.campaignId.toUpperCase(),
    );
    candidates.push(...raw.recommendations);
    currentInsights.push({ campaignId: entry.campaignId, spend: entry.case.current.spend });
    const pv = entry.case.paidValueGate?.paidValueCents;
    if (typeof pv === "number") paidValueByCampaign.set(entry.campaignId, pv);
  }
  if (c.signalBreaches && c.signalBreaches.length > 0) {
    const breaches: Breach[] = c.signalBreaches.map((b) => ({
      signal: b.signal,
      severity: b.severity,
      message: b.message,
    }));
    candidates.push(
      ...generateSignalHealthRecommendations(makeSignalReport(breaches), {
        pixelId: "px_eval",
        accountId: "act_eval",
      }),
    );
  }
  const result = arbitrate({
    candidates,
    revenueState: assembleRevenueState({
      measurementTrusted: c.accountMeasurementTrusted ?? true,
      marginBasis: "unavailable",
      economicTier: c.accountEconomicTier,
      effectiveTarget: c.accountEffectiveTarget,
    }),
    currentInsights,
    ...(paidValueByCampaign.size > 0 ? { paidValueByCampaign } : {}),
  });
  return {
    primary: result.primary
      ? { campaignId: result.primary.campaignId, action: result.primary.action }
      : null,
    secondaryActions: [...new Set(result.secondary.map((s) => s.action))].sort(),
    ...(result.measurementFix ? { measurementFixAction: result.measurementFix.action } : {}),
  };
}
