// ---------------------------------------------------------------------------
// Cockpit /activity deps wiring (A.4)
//
// Builds the runtime deps the route consumes:
// - `previewReader` — Prisma-backed batch reader for ConversationMessage rows
//   that hydrate ActivityRow.preview.
// - `fetchAuditEntries` — org-scoped AuditEntry reader. The route asks for
//   `limit` rows; we over-fetch by AGENT_OVERFETCH_MULTIPLIER to leave room
//   for the in-TS agent filter (translator drops entries that don't match
//   the requested agentKey via actorId/snapshot.agentRole/UUID-fallback).
// ---------------------------------------------------------------------------

import type { PrismaClient, RecommendationOutcomeReadModel } from "@switchboard/db";
import { PrismaActivityPreviewReader } from "@switchboard/db";
import type { ActivityPreviewReader, AuditEntryForTranslator } from "@switchboard/core";

/**
 * Multiplier applied to the requested page size when querying AuditEntry.
 * After translation, the route slices the output back to `limit`. The
 * multiplier exists because the AuditEntry where-clause filters by
 * `actorType: "agent"` only — agent identity (alex vs riley) is decided
 * in TS by the translator, which may discard a meaningful fraction of
 * the over-fetched rows. ×4 is the agreed default; raise if pilot data
 * shows the in-TS filter starving the page.
 */
export const AGENT_OVERFETCH_MULTIPLIER = 4;

export interface CockpitActivityDeps {
  previewReader: ActivityPreviewReader;
  fetchAuditEntries: (args: { orgId: string; limit: number }) => Promise<AuditEntryForTranslator[]>;
  /**
   * Slice 3: renderable Riley outcome rows merged into the activity feed
   * (the operator surface that replaced the retired /riley cockpit).
   * Optional: when absent the feed is audit-only (backward compatible).
   */
  listRenderableOutcomes?: (args: {
    orgId: string;
    limit: number;
  }) => Promise<RecommendationOutcomeReadModel[]>;
}

export function buildCockpitActivityDeps(prisma: PrismaClient): CockpitActivityDeps {
  const previewReader = new PrismaActivityPreviewReader(prisma);

  return {
    previewReader,
    async fetchAuditEntries({ orgId, limit }) {
      const rows = await prisma.auditEntry.findMany({
        where: { organizationId: orgId, actorType: "agent" },
        orderBy: { timestamp: "desc" },
        take: limit * AGENT_OVERFETCH_MULTIPLIER,
        select: {
          id: true,
          eventType: true,
          timestamp: true,
          actorType: true,
          actorId: true,
          snapshot: true,
        },
      });
      return rows.map(
        (r: {
          id: string;
          eventType: string;
          timestamp: Date;
          actorType: string;
          actorId: string;
          snapshot: unknown;
        }) => ({
          id: r.id,
          eventType: r.eventType,
          timestamp: r.timestamp.toISOString(),
          actorType: r.actorType,
          actorId: r.actorId,
          snapshot: (r.snapshot ?? {}) as Record<string, unknown>,
        }),
      );
    },
  };
}
