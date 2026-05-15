import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isAttributableKind,
  KIND_CONFIG,
  SETTLEMENT_LAG_HOURS,
  type AttributableKind,
  type AttributableRecommendation,
  type AttributableRecommendationStore,
  type RecommendationOutcomeStore,
  type RileyOutcomeRow,
} from "@switchboard/core";

export class RecommendationOutcomeAlreadyExistsError extends Error {
  constructor(public readonly recommendationId: string) {
    super(`RecommendationOutcome already exists for recommendation ${recommendationId}`);
    this.name = "RecommendationOutcomeAlreadyExistsError";
  }
}

/**
 * Tolerant extractor for the campaign identity carried on a recommendation row.
 * Riley emits campaignId inside targetEntities, but historic shapes have varied
 * (top-level field, array of {kind, id}, parameters payload). Try the known
 * locations in priority order; return null if none match.
 *
 * Tested against real PendingActionRecord rows in the store tests.
 */
export function extractCampaignIdentity(row: {
  targetEntities: Prisma.JsonValue;
  parameters: Prisma.JsonValue;
}): { campaignId: string; campaignName: string | null } | null {
  const te = row.targetEntities;
  const params = row.parameters;

  // Shape 1: { campaignId: "...", campaignName?: "..." } on targetEntities
  if (te && typeof te === "object" && !Array.isArray(te)) {
    const obj = te as Record<string, unknown>;
    if (typeof obj.campaignId === "string" && obj.campaignId.length > 0) {
      return {
        campaignId: obj.campaignId,
        campaignName: typeof obj.campaignName === "string" ? obj.campaignName : null,
      };
    }
    // Shape 2: { entities: [{ kind: "campaign", id, name? }, ...] } on targetEntities
    if (Array.isArray(obj.entities)) {
      const match = obj.entities.find(
        (e: unknown): e is { kind: string; id: string; name?: string } =>
          !!e &&
          typeof e === "object" &&
          (e as { kind?: unknown }).kind === "campaign" &&
          typeof (e as { id?: unknown }).id === "string",
      );
      if (match) {
        return {
          campaignId: match.id,
          campaignName: typeof match.name === "string" ? match.name : null,
        };
      }
    }
  }

  // Shape 3: bare array of {kind, id, name?}
  if (Array.isArray(te)) {
    const match = (te as unknown[]).find(
      (e): e is { kind: string; id: string; name?: string } =>
        !!e &&
        typeof e === "object" &&
        (e as { kind?: unknown }).kind === "campaign" &&
        typeof (e as { id?: unknown }).id === "string",
    );
    if (match) {
      return {
        campaignId: match.id,
        campaignName: typeof match.name === "string" ? match.name : null,
      };
    }
  }

  // Shape 4: parameters.campaignId fallback
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const obj = params as Record<string, unknown>;
    if (typeof obj.campaignId === "string" && obj.campaignId.length > 0) {
      return { campaignId: obj.campaignId, campaignName: null };
    }
  }

  return null;
}

export class PrismaRecommendationOutcomeStore implements RecommendationOutcomeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: RileyOutcomeRow): Promise<void> {
    try {
      await this.prisma.recommendationOutcome.create({
        data: {
          recommendationId: row.recommendationId,
          executableWorkUnitId: row.executableWorkUnitId,
          organizationId: row.organizationId,
          agentRole: row.agentRole,
          actionKind: row.actionKind,
          anchorAt: row.anchorAt,
          windowStartedAt: row.windowStartedAt,
          windowEndedAt: row.windowEndedAt,
          attributionMethod: row.attributionMethod,
          confidence: row.confidence,
          cockpitRenderable: row.cockpitRenderable,
          metricSummary: row.metricSummary as Prisma.InputJsonValue,
          // Prisma nullable JSON column: must use Prisma.JsonNull, not raw null.
          copyTemplate: row.copyTemplate,
          copyValues:
            row.copyValues === null ? Prisma.JsonNull : (row.copyValues as Prisma.InputJsonValue),
          visibilityFlags: row.visibilityFlags as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        throw new RecommendationOutcomeAlreadyExistsError(row.recommendationId);
      }
      throw err;
    }
  }

  async existsByRecommendationId(recommendationId: string): Promise<boolean> {
    const row = await this.prisma.recommendationOutcome.findUnique({
      where: { recommendationId },
      select: { id: true },
    });
    return row !== null;
  }

  async listRenderableForOrg(args: {
    orgId: string;
    agentRole: string;
    limit: number;
  }): Promise<RecommendationOutcomeReadModel[]> {
    const rows = await this.prisma.recommendationOutcome.findMany({
      where: {
        organizationId: args.orgId,
        agentRole: args.agentRole,
        cockpitRenderable: true,
      },
      orderBy: { windowEndedAt: "desc" },
      take: args.limit,
      include: {
        // Join the parent recommendation so the projection can extract
        // campaignId + campaignName for the API's activity-row body. Avoids
        // a second roundtrip from the route.
        recommendation: {
          select: { targetEntities: true, parameters: true },
        },
      },
    });
    return rows.map(projectReadModel);
  }
}

export interface RecommendationOutcomeReadModel {
  id: string;
  recommendationId: string;
  actionKind: AttributableKind;
  windowEndedAt: Date;
  copyTemplate: string | null;
  copyValues: { deltaPct: number; windowDays: number } | null;
  campaignId: string | null;
  campaignName: string | null;
}

function projectReadModel(row: {
  id: string;
  recommendationId: string;
  actionKind: string;
  windowEndedAt: Date;
  copyTemplate: string | null;
  copyValues: Prisma.JsonValue;
  recommendation: { targetEntities: Prisma.JsonValue; parameters: Prisma.JsonValue } | null;
}): RecommendationOutcomeReadModel {
  const cv = row.copyValues as { deltaPct?: number; windowDays?: number } | null;
  const campaign = row.recommendation ? extractCampaignIdentity(row.recommendation) : null;
  return {
    id: row.id,
    recommendationId: row.recommendationId,
    actionKind: row.actionKind as AttributableKind,
    windowEndedAt: row.windowEndedAt,
    copyTemplate: row.copyTemplate,
    copyValues:
      cv && typeof cv.deltaPct === "number" && typeof cv.windowDays === "number"
        ? { deltaPct: cv.deltaPct, windowDays: cv.windowDays }
        : null,
    campaignId: campaign?.campaignId ?? null,
    campaignName: campaign?.campaignName ?? null,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export class PrismaAttributableRecommendationStore implements AttributableRecommendationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findAttributableCandidates(args: {
    organizationId: string;
    now: Date;
  }): Promise<AttributableRecommendation[]> {
    // SQL prefilter: pull candidates whose attribution window has closed for AT LEAST ONE kind.
    // The smallest windowDays gives the earliest cutoff that is still inclusive for all kinds.
    // For pause (7d): eligible after now - 7d - 24h; for refresh_creative (14d): now - 14d - 24h.
    // Using minWindowDays (7d) means the cutoff is now - 7d - 24h — rows newer than that are
    // still in-window for pause and therefore correctly excluded. Per-kind eligibility is refined
    // in TS via isAttributionEligible() after the SQL fetch.
    const minWindowDays = Math.min(...Object.values(KIND_CONFIG).map((c) => c.windowDays));
    const cutoff = new Date(
      args.now.getTime() - SETTLEMENT_LAG_HOURS * MS_PER_HOUR - minWindowDays * MS_PER_DAY,
    );

    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        organizationId: args.organizationId,
        sourceAgent: "riley",
        status: "acted",
        intent: { startsWith: "recommendation." },
        resolvedAt: { not: null, lte: cutoff },
        recommendationOutcome: { is: null },
      },
      orderBy: { resolvedAt: "asc" },
    });

    return rows
      .map(projectBaseCandidate)
      .filter(
        (c): c is AttributableRecommendation => c !== null && isAttributionEligible(c, args.now),
      );
  }

  async findOverlapsForCampaign(args: {
    organizationId: string;
    campaignId: string;
    excludeRecommendationId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Pick<AttributableRecommendation, "id" | "actionKind">[]> {
    const rows = await this.prisma.pendingActionRecord.findMany({
      where: {
        id: { not: args.excludeRecommendationId },
        organizationId: args.organizationId,
        sourceAgent: "riley",
        status: "acted",
        intent: { startsWith: "recommendation." },
        resolvedAt: { not: null, gte: args.windowStart, lte: args.windowEnd },
      },
    });

    // No eligibility check here — a same-campaign rec that is still mid-window
    // is just as much an overlap as one whose attribution window has closed.
    return rows
      .map(projectBaseCandidate)
      .filter(
        (c): c is AttributableRecommendation => c !== null && c.campaignId === args.campaignId,
      )
      .map((c) => ({ id: c.id, actionKind: c.actionKind }));
  }
}

interface PrismaCandidateRow {
  id: string;
  organizationId: string;
  parameters: Prisma.JsonValue;
  targetEntities: Prisma.JsonValue;
  resolvedAt: Date | null;
}

/**
 * Extracts the base attribution shape from a DB row: validates kind and
 * campaign identity, but does NOT apply the time-eligibility check.
 * Callers are responsible for applying eligibility where needed.
 */
function projectBaseCandidate(row: PrismaCandidateRow): AttributableRecommendation | null {
  if (!row.resolvedAt) return null;

  const params = (row.parameters ?? {}) as { __recommendation?: { action?: string } };
  const kind = params.__recommendation?.action;
  if (!isAttributableKind(kind)) return null;

  const identity = extractCampaignIdentity(row);
  if (!identity) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    campaignId: identity.campaignId,
    actionKind: kind,
    resolvedAt: row.resolvedAt,
  };
}

/**
 * Returns true when the attribution window + settlement lag has elapsed,
 * meaning this recommendation is ready for outcome attribution.
 */
function isAttributionEligible(candidate: AttributableRecommendation, now: Date): boolean {
  const windowDays = KIND_CONFIG[candidate.actionKind].windowDays;
  const eligibleAfter = new Date(
    candidate.resolvedAt.getTime() + windowDays * MS_PER_DAY + SETTLEMENT_LAG_HOURS * MS_PER_HOUR,
  );
  return eligibleAfter.getTime() <= now.getTime();
}
