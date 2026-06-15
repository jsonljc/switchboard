import type { AdsClientInterface } from "./audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
  WeeklyCampaignSnapshot,
} from "@switchboard/schemas";
import { ZERO_CONVERSION_DAY_CLICK_FLOOR } from "./evidence-floor.js";

const MATERIAL_CHILD_SPEND_SHARE = 0.1;
const MIN_LEARNING_COVERAGE = 0.8;
// The Meta insights edge does not expose campaign last-modified. The native ad-set
// learningPhase (deriveLearningPhase, from learning_stage_info) is the authoritative
// learning signal, so report a value >= the V1 guard's 7-day recency window: this keeps
// the legacy "recently-modified + <50 conversions" data heuristic from firing on data we
// don't actually have, and lets the native signal govern.
const LAST_MODIFIED_DAYS_UNKNOWN = 30;

export class MetaCampaignInsightsProvider implements CampaignInsightsProvider {
  private readonly adsClient: AdsClientInterface;

  constructor(adsClient: AdsClientInterface) {
    this.adsClient = adsClient;
  }

  async getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    /**
     * D2-7 batching: account-level learning rows pre-fetched ONCE above the per-campaign loop.
     * Present ⇒ used directly (matched by campaignId) and the account re-fetch is skipped. The
     * per-campaign ad-set learning call (deriveLearningPhase) is a separate endpoint, unaffected.
     */
    prefetchedLearningRows?: CampaignInsight[];
  }): Promise<CampaignLearningInput> {
    const insights = input.prefetchedLearningRows ?? (await this.fetchAccountLearningRows());

    const match = insights.find((i) => i.campaignId === input.campaignId);

    const learningPhase = await this.deriveLearningPhase(input.campaignId);

    return {
      // effective_status is not requested off /insights, so the mapped row carries
      // "" — treat empty (or missing) as the honest "UNKNOWN", not a blank string.
      effectiveStatus: match?.effectiveStatus || "UNKNOWN",
      learningPhase,
      lastModifiedDays: LAST_MODIFIED_DAYS_UNKNOWN,
      optimizationEvents: match?.conversions ?? 0,
    };
  }

  private async deriveLearningPhase(campaignId: string): Promise<boolean> {
    if (!this.adsClient.getAdSetLearningInputs) return false;
    const adSets = await this.adsClient.getAdSetLearningInputs(campaignId);
    const totalSpend = adSets.reduce((s, a) => s + a.spend, 0);
    // No ad-set spend signal (zero spend, or no ad sets) ⇒ false (not "in learning").
    // Deliberate and currently safe: a zero-spend campaign yields no breach days
    // (getTargetBreachStatus skips spend<=0 days) and no actionable recommendation, so
    // this never exposes such a campaign to a destructive action. It also matches the
    // no-data graceful stance (the getAdSetLearningInputs-absent path returns false too).
    // NOTE for future consumers of `learningPhase`: if a recommendation is ever added
    // that acts on zero-spend campaigns, revisit this to "protect when in doubt".
    if (totalSpend <= 0 || adSets.length === 0) return false;

    const knownSpend = adSets
      .filter((a) => a.learningStageStatus !== "UNKNOWN")
      .reduce((s, a) => s + a.spend, 0);
    if (knownSpend / totalSpend < MIN_LEARNING_COVERAGE) return true; // incomplete coverage ⇒ protect

    const anyMaterialChildLearning = adSets.some(
      (a) =>
        a.spend / totalSpend >= MATERIAL_CHILD_SPEND_SHARE && a.learningStageStatus === "LEARNING",
    );
    return anyMaterialChildLearning;
  }

  async getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
    /**
     * Phase-A Gate 1: when set, the conversions denominator for the breach test
     * is the value of THIS Meta `actions` entry (e.g. "lead"/"purchase") under a
     * pinned attribution window, not the unfiltered aggregate `conversions` field.
     * Unset ⇒ aggregate `conversions` (unchanged back-compat behavior).
     */
    conversionActionType?: string;
    /** Attribution windows to pin when `conversionActionType` is set. Default ["7d_click"]. */
    attributionWindows?: string[];
    /**
     * D2-7 batching: account-level daily rows pre-fetched ONCE above the per-campaign loop.
     * When present they are used directly (filtered by campaignId below) and the per-campaign
     * account re-fetch is skipped. Absent ⇒ fetch as before (back-compat for analysis-only /
     * eval callers that inject a provider without batching).
     */
    prefetchedDailyRows?: CampaignInsight[];
  }): Promise<TargetBreachResult> {
    // When pre-fetched rows are supplied, skip the account re-fetch entirely; otherwise fetch the
    // account-level daily breach window exactly as before. fetchAccountDailyRows owns the window +
    // denominator field-set logic so the hoisted and per-campaign paths can never drift.
    const rows =
      input.prefetchedDailyRows ??
      (await this.fetchAccountDailyRows({
        endDate: input.endDate,
        ...(input.conversionActionType ? { conversionActionType: input.conversionActionType } : {}),
        ...(input.attributionWindows ? { attributionWindows: input.attributionWindows } : {}),
      }));

    const campaignDays = rows.filter((r) => r.campaignId === input.campaignId);

    // NOTE: currently DORMANT in production — the audit-runner does not yet pass
    // `snapshots`, so this branch is a safe-by-default contract for a future
    // weekly-snapshot source (follow-up). It fails safe (daily/0) when unfed.
    if (campaignDays.length === 0 && input.snapshots && input.snapshots.length > 0) {
      let weekly = 0;
      for (const snap of input.snapshots) {
        if (snap.cpa != null && snap.cpa > input.targetCPA) weekly++;
      }
      return { periodsAboveTarget: weekly, granularity: "weekly", isApproximate: true };
    }

    // Phase-A breach-counter fix: a zero-conversion day is only real "breach" signal when
    // the campaign has enough total window volume for "zero conversions" to mean something.
    // Below the click floor, a quiet low-traffic day is noise — counting it as a breach lets
    // a near-zero-traffic campaign accrue durability and get paused on nothing. Days WITH
    // conversions are unaffected (breach iff cpa > target).
    const windowClicks = campaignDays.reduce((s, d) => s + d.inlineLinkClicks, 0);
    const zeroDayCounts = windowClicks >= ZERO_CONVERSION_DAY_CLICK_FLOOR;

    // Selected per-day conversions denominator (Gate 1): the configured action
    // type's value when set, else the aggregate `conversions` field. This single
    // value feeds BOTH the volume gate's notion of "zero conversions" and the
    // cpa breach test below; the clicks-based gate itself is unchanged.
    const dayConversions = (day: CampaignInsight): number => {
      if (!input.conversionActionType) return day.conversions;
      const raw = Number(
        day.actions?.find((a) => a.action_type === input.conversionActionType)?.value ?? 0,
      );
      return Number.isFinite(raw) ? raw : 0;
    };

    let periodsAboveTarget = 0;
    for (const day of campaignDays) {
      if (day.spend <= 0) continue; // no spend → not a breach day
      const conv = dayConversions(day);
      // Local boolean — never carry Infinity into rationale/logs/evidence downstream.
      const breached = conv > 0 ? day.spend / conv > input.targetCPA : zeroDayCounts; // was `day.spend > 0` — the footgun
      if (breached) periodsAboveTarget++;
    }

    return { periodsAboveTarget, granularity: "daily", isApproximate: false };
  }

  /**
   * D2-7 batching: pull the account-level daily breach window AND the 7-day learning window ONCE
   * for the whole account (2 Graph calls total, independent of campaign count). The audit-runner
   * calls this above the per-campaign loop and feeds the rows back via prefetched* inputs. Reuses
   * the same private fetchers as the per-campaign path, so the field sets cannot diverge.
   */
  async prefetchAccountRows(input: {
    endDate: Date;
    conversionActionType?: string;
    attributionWindows?: string[];
  }): Promise<{ daily: CampaignInsight[]; learning: CampaignInsight[] }> {
    const [daily, learning] = await Promise.all([
      this.fetchAccountDailyRows({
        endDate: input.endDate,
        ...(input.conversionActionType ? { conversionActionType: input.conversionActionType } : {}),
        ...(input.attributionWindows ? { attributionWindows: input.attributionWindows } : {}),
      }),
      this.fetchAccountLearningRows(),
    ]);
    return { daily, learning };
  }

  /**
   * Fetch the account-level 7-day learning window ONCE (one row per campaign, aggregated).
   * Shared by getCampaignLearningData's per-campaign fallback AND prefetchAccountRows.
   */
  private async fetchAccountLearningRows(): Promise<CampaignInsight[]> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    return this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(now) },
      // `effective_status` is invalid on the `/insights` edge (it would always map to "");
      // effectiveStatus is advisory (learning phase is authoritatively derived from
      // learning_stage_info) and defaults to "UNKNOWN" in the caller.
      fields: ["campaign_id", "conversions"],
    });
  }

  /**
   * Fetch the account-level daily breach window ONCE (time_increment=1, 14 inclusive days
   * ending at `endDate`). Shared by getTargetBreachStatus's per-campaign fallback AND the
   * batched prefetchAccountRows path, so the requested field set never diverges between them.
   */
  private async fetchAccountDailyRows(input: {
    endDate: Date;
    conversionActionType?: string;
    attributionWindows?: string[];
  }): Promise<CampaignInsight[]> {
    const BREACH_WINDOW_DAYS = 14;
    const until = input.endDate;
    const since = new Date(until);
    // -(N-1): Meta's time_range is inclusive of both ends, so this spans exactly
    // BREACH_WINDOW_DAYS daily buckets.
    since.setDate(since.getDate() - (BREACH_WINDOW_DAYS - 1));

    // Denominator selection (Gate 1): an action-type denominator requires the
    // `actions` breakdown and a PINNED attribution window so the per-day value is
    // stable run-to-run. When unset we leave both off — exact back-compat: the
    // aggregate `conversions` field under Meta's account-default windows.
    const useActionDenominator = Boolean(input.conversionActionType);
    return this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(until) },
      fields: useActionDenominator
        ? ["campaign_id", "spend", "conversions", "inline_link_clicks", "actions"]
        : ["campaign_id", "spend", "conversions", "inline_link_clicks"],
      timeIncrement: 1,
      ...(useActionDenominator
        ? { actionAttributionWindows: input.attributionWindows ?? ["7d_click"] }
        : {}),
    });
  }
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0]!;
}
