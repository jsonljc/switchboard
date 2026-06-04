import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  StaleVersionError,
  type AsyncFailureContext,
} from "@switchboard/core";
import {
  CreativePastPerformanceSchema,
  type CampaignInsightSchema,
  type CreativeJob,
  type CreativePastPerformance,
} from "@switchboard/schemas";
import { trueRoasFromCents } from "@switchboard/ad-optimizer";

// Local Inngest client. All function registrations in apps/api share the same
// switchboard id — they fan out to the single serve handler in bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

/** Per-creative history older than this is truncated (slice-2 spec 3.3 window clamp). */
const WINDOW_CLAMP_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Explicit insights field list (spec 3.3). Everything the typed
 * pastPerformance.meta block carries, nothing more.
 */
export const ATTRIBUTION_INSIGHT_FIELDS = [
  "campaign_id",
  "spend",
  "impressions",
  "inline_link_clicks",
  "inline_link_click_ctr",
  "conversions",
  "cpm",
] as const;

// ── Dispatch ──

export interface CreativeAttributionDispatchDeps {
  /** Distinct orgs with at least one published creative (metaCampaignId set). */
  listPublishedCreativeOrgs: () => Promise<string[]>;
  /** Bound to inngestClient.send in apps/api. */
  sendEvent: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
}

interface DispatchStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeCreativeAttributionDispatch(
  step: DispatchStepTools,
  deps: CreativeAttributionDispatchDeps,
): Promise<{ dispatched: number }> {
  const orgs = await step.run("list-published-creative-orgs", () =>
    deps.listPublishedCreativeOrgs(),
  );
  for (const orgId of orgs) {
    await step.run(`emit-${orgId}`, async () => {
      await deps.sendEvent({ name: "creative-pipeline/attribution.refresh", data: { orgId } });
    });
  }
  return { dispatched: orgs.length };
}

/**
 * Daily dispatch cron (06:30 UTC, before the Riley pass at 07:00): one
 * "creative-pipeline/attribution.refresh" event per org with published
 * creatives. Read-only; the per-org worker owns the kill-switch (mirrors the
 * Riley pair: dispatch always fires, the worker short-circuits when dark).
 */
export function createCreativeAttributionDispatch(
  deps: CreativeAttributionDispatchDeps,
  onFailure?: (arg: unknown) => Promise<void>,
) {
  return inngestClient.createFunction(
    {
      id: "creative-attribution-dispatch",
      name: "Creative Attribution Dispatch",
      retries: 2,
      triggers: [{ cron: "30 6 * * *" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ step }) =>
      executeCreativeAttributionDispatch(step as unknown as DispatchStepTools, deps),
  );
}

// ── Worker ──

export interface MetaAdsCredentials {
  accessToken: string;
  accountId: string;
}

/** The MetaAdsClient subset the worker uses (tests inject a mock). */
export interface InsightsClientLike {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<CampaignInsightSchema[]>;
}

export interface CreativeAttributionWorkerDeps {
  failure: AsyncFailureContext;
  /** Read per invocation: CREATIVE_ATTRIBUTION_ENABLED === "true". */
  readEnabledFlag: () => boolean;
  jobStore: {
    listPublished(organizationId: string): Promise<CreativeJob[]>;
    setPastPerformance(
      organizationId: string,
      id: string,
      performance: Record<string, unknown>,
    ): Promise<void>;
  };
  conversionStore: {
    queryBookedStatsByCampaign(query: {
      orgId: string;
      from: Date;
      to: Date;
      campaignIds?: string[];
    }): Promise<Map<string, { valueCents: number; count: number }>>;
  };
  /** Credentials-only resolver on the org meta-ads Connection; null = graceful no-op. */
  resolveMetaCredentials: (orgId: string) => Promise<MetaAdsCredentials | null>;
  makeAdsClient: (creds: MetaAdsCredentials) => InsightsClientLike;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface CreativeAttributionRunSummary {
  orgId: string;
  published: number;
  written: number;
  noDowngradeSkips: number;
  vanishedSkips: number;
}

export interface ComputePastPerformanceInput {
  /** A published job (metaCampaignId non-null; listPublished guarantees it). */
  job: CreativeJob;
  /** Absent = Meta omitted the campaign from insights (zero delivery). */
  insight: CampaignInsightSchema | undefined;
  /** Absent = no value-positive booked record attributed to the campaign. */
  booked: { valueCents: number; count: number } | undefined;
  window: { from: Date; to: Date };
  now: Date;
}

/**
 * One job's pastPerformance row, or null when the NO-DOWNGRADE rule applies:
 * an absent insight row also occurs when an operator DELETES a formerly-
 * delivering campaign in Ads Manager, and overwriting a prior `measured` row
 * with zeros would erase earned history — the prior snapshot stays, its asOf
 * honestly aging. (1:1 campaign:creative is load-bearing for this join; if a
 * future slice consolidates creatives into shared campaigns, the join MUST
 * move to ad-level insights on join.metaAdId — spec 3.1.)
 */
export function computePastPerformance(
  input: ComputePastPerformanceInput,
): CreativePastPerformance | null {
  const { job, insight, booked, window, now } = input;

  if (!insight) {
    const existing = CreativePastPerformanceSchema.safeParse(job.pastPerformance);
    if (existing.success && existing.data.delivery === "measured") return null;
  }

  const valueCents = booked?.valueCents ?? 0;
  const count = booked?.count ?? 0;
  const spend = insight?.spend ?? 0;

  return {
    kind: "measured_performance",
    version: 1,
    asOf: now.toISOString(),
    window: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      days: Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / DAY_MS)),
    },
    delivery: insight ? "measured" : "no_delivery",
    join: {
      metaCampaignId: job.metaCampaignId as string,
      metaAdId: job.metaAdId ?? null,
      metaVideoId: job.metaVideoId ?? null,
    },
    meta: {
      spend,
      impressions: insight?.impressions ?? 0,
      inlineLinkClicks: insight?.inlineLinkClicks ?? 0,
      inlineLinkClickCtr: insight?.inlineLinkClickCtr ?? 0,
      conversions: insight?.conversions ?? 0,
      cpm: insight?.cpm ?? 0,
    },
    booked: { valueCents, count },
    // null when no value-positive booked record exists: absence of attributed
    // records is not proof the creative earned zero (conversions can exist
    // unattributed). Cents normalize to major units ONLY inside the helper.
    trueRoas: trueRoasFromCents(count === 0 ? null : valueCents, spend),
    source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
  };
}

/**
 * Pure per-org handler extracted from the Inngest wrapper so it is unit-
 * testable without an Inngest client (the riley-outcome-attribution pattern).
 *
 * One account-level insights call per org (60s client self-limit respected by
 * construction: a fresh client per invocation, one call). Missing credentials,
 * no published jobs, and absent insight rows are graceful no-ops, not failures.
 */
export async function executeCreativeAttributionWorker(
  deps: CreativeAttributionWorkerDeps,
  event: { data: unknown; name: string },
): Promise<CreativeAttributionRunSummary | { skipped: string }> {
  const orgId = (event.data as { orgId?: string } | undefined)?.orgId;
  if (!orgId) {
    deps.logger.error({ msg: "creative-attribution: missing orgId in event payload" });
    throw new Error("missing orgId");
  }
  if (!deps.readEnabledFlag()) {
    deps.logger.info({ msg: "creative-attribution", skipped: "disabled", orgId });
    return { skipped: "disabled" };
  }

  const jobs = await deps.jobStore.listPublished(orgId);
  if (jobs.length === 0) {
    deps.logger.info({ msg: "creative-attribution", skipped: "no_published_jobs", orgId });
    return { skipped: "no_published_jobs" };
  }

  // Re-resolved fresh per invocation (the creative-publish-function pattern):
  // the decrypted token never enters Inngest step state.
  const creds = await deps.resolveMetaCredentials(orgId);
  if (!creds) {
    deps.logger.warn({ msg: "creative-attribution", skipped: "no_meta_credentials", orgId });
    return { skipped: "no_meta_credentials" };
  }

  // One window per org so the insights call stays single: earliest published
  // job's createdAt, clamped to the last WINDOW_CLAMP_DAYS (documented;
  // revisited when any creative has more delivery history than the clamp).
  const now = new Date();
  const earliestMs = jobs.reduce(
    (min, j) => Math.min(min, new Date(j.createdAt).getTime()),
    now.getTime(),
  );
  const from = new Date(Math.max(earliestMs, now.getTime() - WINDOW_CLAMP_DAYS * DAY_MS));
  const window = { from, to: now };

  // Meta boundary: YYYY-MM-DD, until-inclusive (meta-insights-adapter convention).
  const ymd = (d: Date) => d.toISOString().split("T")[0]!;
  const ads = deps.makeAdsClient(creds);
  const insights = await ads.getCampaignInsights({
    dateRange: { since: ymd(from), until: ymd(now) },
    fields: [...ATTRIBUTION_INSIGHT_FIELDS],
  });
  const insightByCampaign = new Map(insights.map((i) => [i.campaignId, i]));

  const campaignIds = jobs
    .map((j) => j.metaCampaignId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const bookedStats = await deps.conversionStore.queryBookedStatsByCampaign({
    orgId,
    from,
    to: now,
    campaignIds,
  });

  let written = 0;
  let noDowngradeSkips = 0;
  let vanishedSkips = 0;
  for (const job of jobs) {
    if (!job.metaCampaignId) continue; // listPublished filters; defensive
    const row = computePastPerformance({
      job,
      insight: insightByCampaign.get(job.metaCampaignId),
      booked: bookedStats.get(job.metaCampaignId),
      window,
      now,
    });
    if (!row) {
      noDowngradeSkips += 1;
      continue;
    }
    try {
      await deps.jobStore.setPastPerformance(orgId, job.id, row);
      written += 1;
    } catch (err) {
      // The job was read from this org moments ago; a count===0 write means it
      // vanished mid-run (deleted). Benign — skip and count it. Anything else
      // is a real failure owned by retries + the dead-letter contract.
      if (err instanceof StaleVersionError) {
        vanishedSkips += 1;
        continue;
      }
      throw err;
    }
  }

  const summary: CreativeAttributionRunSummary = {
    orgId,
    published: jobs.length,
    written,
    noDowngradeSkips,
    vanishedSkips,
  };
  deps.logger.info({ msg: "creative-attribution-summary", ...summary });
  return summary;
}

/**
 * Class-E failure contract (spec 3.2) — a DELIBERATE divergence from the Riley
 * worker's medium+emits: this worker writes a refreshable projection the next
 * daily run rebuilds, and a `creative.attribution.failed` event would have
 * zero consumers. The `infrastructure.job.retry_exhausted` audit entry is
 * ALWAYS recorded (makeOnFailureHandler); no domain event, no operator alert.
 */
export const CREATIVE_ATTRIBUTION_WORKER_FAILURE_PARAMS = {
  functionId: "creative-attribution-worker",
  eventDomain: "creative.attribution",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

/**
 * Per-org attribution worker. Triggered by "creative-pipeline/attribution.refresh"
 * events from the dispatch cron. Kill-switch: readEnabledFlag() false short-
 * circuits immediately — no job reads, no Meta calls, no DB writes.
 */
export function createCreativeAttributionWorker(deps: CreativeAttributionWorkerDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-attribution-worker",
      retries: 2,
      triggers: [{ event: "creative-pipeline/attribution.refresh" }],
      onFailure: makeOnFailureHandler(CREATIVE_ATTRIBUTION_WORKER_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event }) => executeCreativeAttributionWorker(deps, event),
  );
}

// ── Credentials ──

/**
 * Credentials-only resolver on the org's Meta Ads Connection (serviceId
 * "meta-ads"): org-scoped findFirst, decrypt, extract accessToken/accountId
 * (externalAccountId fallback). Deliberately NOT assertPublishable — that is
 * publish-specific (kept-status, page-id), neither of which attribution needs.
 * Returns null (graceful no-op) instead of failing when the connection or
 * fields are missing.
 */
export async function resolveMetaAdsConnectionCredentials(
  prisma: {
    connection: {
      findFirst: (args: {
        where: { serviceId: string; organizationId: string };
        select: { credentials: true; externalAccountId: true };
      }) => Promise<{ credentials: unknown; externalAccountId: string | null } | null>;
    };
  },
  decrypt: (encrypted: unknown) => Record<string, unknown>,
  orgId: string,
): Promise<MetaAdsCredentials | null> {
  const connection = await prisma.connection.findFirst({
    where: { serviceId: "meta-ads", organizationId: orgId },
    select: { credentials: true, externalAccountId: true },
  });
  if (!connection) return null;
  const creds = decrypt(connection.credentials);
  const accessToken = typeof creds["accessToken"] === "string" ? creds["accessToken"] : null;
  const accountId =
    typeof creds["accountId"] === "string"
      ? creds["accountId"]
      : (connection.externalAccountId ?? null);
  if (!accessToken || !accountId) return null;
  return { accessToken, accountId };
}
