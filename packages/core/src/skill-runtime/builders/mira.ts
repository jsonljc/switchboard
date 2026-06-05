import { MiraComposeRequestSchema, SURFACING_THRESHOLD } from "@switchboard/schemas";
import type { BusinessFacts, MiraComposeRequest } from "@switchboard/schemas";
import type { SkillStores } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import { renderBusinessFacts } from "../context-resolver.js";
import type {
  MiraCreativeReadModel,
  MiraCreativeJobSummary,
} from "../../creative-read-model/types.js";

/**
 * Slice-4 brain builder (spec 3.3,
 * docs/superpowers/specs/2026-06-05-mira-slice4-brain-design.md): assembles
 * everything Mira reads at brief time from injected stores. Mirrors
 * alexBuilder's rich result shape; the injected keys are the DeploymentMemory
 * canonical keys rendered into TASTE_CONTEXT, threaded to WorkTrace exactly
 * like Alex's injectedPatternIds.
 *
 * No AgentContext: compose has no conversation, persona, or contact. Identity
 * fields derive from BusinessFacts. The brain READS memory; it never writes
 * it (taste belongs to the sweep, revenue_proven to Riley).
 */
export interface MiraBuilderResult {
  parameters: Record<string, unknown>;
  injectedPatternIds: string[];
}

export interface MiraBuilderConfig {
  orgId: string;
  deploymentId: string;
  /** Raw workUnit.parameters; zod-parsed here (parse, don't cast). */
  request: unknown;
  /** Optional clock for deterministic testing. Defaults to `() => new Date()`. */
  now?: () => Date;
}

const FALLBACK_TZ = "Asia/Singapore";
const FALLBACK_BUSINESS_NAME = "the clinic";
const MAX_TASTE_LINES = 12;
const MAX_TOP_PERFORMERS = 3;

const TASTE_KEY = /^taste:(kept|passed)_(polished|ugc)_([a-z0-9_]+)$/;
const REVENUE_PROVEN_KEY = /^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/;

const MODE_LABEL: Record<string, string> = { polished: "polished", ugc: "real-talk" };

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question hooks",
  bold_statement: "bold-statement hooks",
  none: "creatives with no leading hook",
};

interface MemoryRow {
  id: string;
  category: string;
  canonicalKey: string | null;
  sourceCount: number;
  confidence: number;
}

function describeSegment(mode: string, segment: string): string {
  if (mode === "polished") return HOOK_PHRASE[segment] ?? `${segment} hooks`;
  return `${segment.replace(/_/g, " ")} structure`;
}

/**
 * True when at least one surfaced row parses as creative memory (taste or
 * revenue-proven). Shared with the self-brief worker's signal floor so the
 * hard gate and the builder agree on what counts as signal.
 */
export function hasSurfacedCreativeMemorySignal(rows: MemoryRow[]): boolean {
  return rows.some(
    (r) =>
      (r.category === "taste" && r.canonicalKey !== null && TASTE_KEY.test(r.canonicalKey)) ||
      (r.category === "revenue_proven" &&
        r.canonicalKey !== null &&
        REVENUE_PROVEN_KEY.test(r.canonicalKey)),
  );
}

function renderTasteContext(rows: MemoryRow[]): { lines: string[]; keys: string[] } {
  const lines: string[] = [];
  const keys: string[] = [];
  for (const row of rows) {
    if (lines.length >= MAX_TASTE_LINES) break;
    if (!row.canonicalKey) continue;
    if (row.category === "taste") {
      const m = TASTE_KEY.exec(row.canonicalKey);
      if (!m) continue;
      const verb = m[1] === "kept" ? "keeps" : "passes on";
      const noun = m[1] === "kept" ? "keeps" : "passes";
      lines.push(
        `In ${MODE_LABEL[m[2]!]} mode, the operator consistently ${verb} ` +
          `${describeSegment(m[2]!, m[3]!)} (${row.sourceCount} ${noun}).`,
      );
      keys.push(row.canonicalKey);
    } else if (row.category === "revenue_proven") {
      const m = REVENUE_PROVEN_KEY.exec(row.canonicalKey);
      if (!m) continue;
      lines.push(
        `Measured winner in ${MODE_LABEL[m[1]!]} mode: ` +
          `${describeSegment(m[1]!, m[2]!)} (${row.sourceCount} sources).`,
      );
      keys.push(row.canonicalKey);
    }
  }
  return { lines, keys };
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type MeasuredJob = MiraCreativeJobSummary & {
  performance: NonNullable<MiraCreativeJobSummary["performance"]>;
};

function renderPerformanceContext(model: MiraCreativeReadModel): string {
  const { counts } = model;
  const lines: string[] = [
    `Shipped this week: ${counts.shippedThisWeek} (previous week: ${counts.shippedPrevWeek}). ` +
      `In flight: ${counts.inFlight}. Awaiting review: ${counts.awaitingReview}.`,
  ];

  const measured = model.jobs.filter(
    (j): j is MeasuredJob => j.performance?.delivery === "measured",
  );
  if (measured.length === 0) {
    lines.push("No published creatives with measured performance yet.");
  } else {
    const top = [...measured]
      .sort((a, b) => (b.performance.trueRoas ?? -1) - (a.performance.trueRoas ?? -1))
      .slice(0, MAX_TOP_PERFORMERS);
    for (const j of top) {
      const p = j.performance;
      const roas = p.trueRoas === null ? "n/a" : String(p.trueRoas);
      const decision = j.reviewDecision ? `, operator ${j.reviewDecision}` : "";
      lines.push(
        `"${j.title}" (${j.source.mode}): true ROAS ${roas}, $${p.spend} spend, ` +
          `${dollars(p.bookedValueCents)} booked from ${p.bookedCount} bookings${decision}.`,
      );
    }
  }

  const kept = model.jobs.filter((j) => j.reviewDecision === "kept").length;
  const passed = model.jobs.filter((j) => j.reviewDecision === "passed").length;
  if (kept + passed > 0) {
    lines.push(`Operator decisions so far: ${kept} kept, ${passed} passed.`);
  }
  return lines.join("\n");
}

function renderTriggerContext(request: MiraComposeRequest): string {
  if (request.composeSource === "weekly_scan") {
    return "Weekly performance scan. Decide whether the week's signal warrants one new concept.";
  }
  const r = request.recommendation!;
  return (
    `Riley (the ads agent) recommends "${r.actionType}" on campaign ${r.campaignId}. ` +
    `Rationale: ${r.rationale}. Evidence: ${r.evidence.clicks} clicks, ` +
    `${r.evidence.conversions} conversions over ${r.evidence.days} days. ` +
    `Compose the concept brief that would best support this, or abstain if the evidence ` +
    `or operator taste argues against it.`
  );
}

function formatDatetime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} (${get("weekday")}) ${get("hour")}:${get("minute")} ${timeZone}`;
}

export const miraBuilder = async (
  config: MiraBuilderConfig,
  stores: SkillStores,
): Promise<MiraBuilderResult> => {
  const { deploymentMemoryReader, miraReadModelReader, businessFactsStore } = stores;
  if (!deploymentMemoryReader || !miraReadModelReader || !businessFactsStore) {
    throw new ParameterResolutionError(
      "mira-stores-missing",
      "Mira compose is not wired: memory reader, read-model reader, and business facts store are all required.",
    );
  }

  const parsedRequest = MiraComposeRequestSchema.safeParse(config.request);
  if (!parsedRequest.success) {
    throw new ParameterResolutionError(
      "mira-compose-request-invalid",
      `Compose request invalid: ${parsedRequest.error.message}`,
    );
  }
  const request = parsedRequest.data;

  const facts = (await businessFactsStore.get(config.orgId)) as BusinessFacts | null;
  const BUSINESS_NAME = facts?.businessName?.trim() || FALLBACK_BUSINESS_NAME;
  const BUSINESS_FACTS = facts ? renderBusinessFacts(facts) : "";

  // Two distinct timezone fallbacks (spec 3.3): absent facts or absent field
  // defaults; an invalid IANA string degrades via try/catch rather than
  // throwing a RangeError that would fail the whole compose.
  const rawTz = facts?.timezone ?? FALLBACK_TZ;
  const now = config.now?.() ?? new Date();
  let timezone = rawTz;
  let CURRENT_DATETIME: string;
  try {
    CURRENT_DATETIME = formatDatetime(now, rawTz);
  } catch {
    console.warn(`[miraBuilder] Invalid timezone "${rawTz}", falling back to ${FALLBACK_TZ}`);
    timezone = FALLBACK_TZ;
    CURRENT_DATETIME = formatDatetime(now, FALLBACK_TZ);
  }

  const [memoryRows, readModel] = await Promise.all([
    deploymentMemoryReader.listHighConfidence(
      config.orgId,
      config.deploymentId,
      SURFACING_THRESHOLD.minConfidence,
      SURFACING_THRESHOLD.minSourceCount,
    ),
    miraReadModelReader.read(config.orgId, { now, timezone }),
  ]);

  const taste = renderTasteContext(memoryRows);
  const counts = readModel.counts;

  const parameters: Record<string, unknown> = {
    BUSINESS_NAME,
    BUSINESS_FACTS,
    TASTE_CONTEXT: taste.lines.join("\n"),
    PERFORMANCE_CONTEXT: renderPerformanceContext(readModel),
    PIPELINE_STATE:
      `${counts.inFlight} in flight (${counts.awaitingReview} awaiting review), ` +
      `${counts.stopped} stopped.`,
    TRIGGER_CONTEXT: renderTriggerContext(request),
    CURRENT_DATETIME,
  };

  return { parameters, injectedPatternIds: taste.keys };
};
