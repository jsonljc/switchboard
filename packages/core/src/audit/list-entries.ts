import {
  AuditEntryBrowseRowSchema,
  AuditEntriesListQuerySchema,
  AuditEntriesListResponseSchema,
  OPERATIONAL_AUDIT_EVENT_TYPES,
  type AuditEntry,
  type AuditEntryBrowseRow,
  type AuditEntriesListQuery,
  type AuditEntriesListResponse,
} from "@switchboard/schemas";
import type { AuditLedger, AuditLedgerBrowseFilter } from "./ledger.js";

const SNAPSHOT_KEY_ALLOWLIST = new Set([
  "id",
  "kind",
  "source",
  "actionType",
  "decisionId",
  "recommendationId",
  "approvalId",
  "envelopeId",
  "agentKey",
  "targetEntityType",
  "targetEntityId",
  "correlationId",
  "traceId",
]);

const MAX_LIMIT = 100;
const HASH_PREFIX_LEN = 16;

interface CursorShape {
  timestamp: string; // ISO8601
  id: string;
}

export class CursorDecodeError extends Error {
  constructor(message = "Malformed cursor") {
    super(message);
    this.name = "CursorDecodeError";
  }
}

function encodeCursor(c: CursorShape): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): CursorShape {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { timestamp?: unknown }).timestamp !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new CursorDecodeError();
    }
    const p = parsed as { timestamp: string; id: string };
    return { timestamp: p.timestamp, id: p.id };
  } catch (err) {
    if (err instanceof CursorDecodeError) throw err;
    throw new CursorDecodeError();
  }
}

function project(entry: AuditEntry): AuditEntryBrowseRow {
  const snapshotKeys: string[] = [];
  let redactedKeyCount = 0;
  for (const key of Object.keys(entry.snapshot)) {
    if (SNAPSHOT_KEY_ALLOWLIST.has(key)) snapshotKeys.push(key);
    else redactedKeyCount++;
  }

  return AuditEntryBrowseRowSchema.parse({
    id: entry.id,
    eventType: entry.eventType,
    timestamp: entry.timestamp.toISOString(),
    actorType: entry.actorType,
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    riskCategory: entry.riskCategory,
    visibilityLevel: entry.visibilityLevel,
    summary: entry.summary,
    snapshotKeys: snapshotKeys.sort(), // deterministic for tests + cache
    redactedKeyCount,
    evidencePointers: entry.evidencePointers.map((p) => ({
      type: p.type,
      hash: p.hash, // full hash — integrity anchor, not sensitive
      hashPrefix: p.hash.slice(0, HASH_PREFIX_LEN),
      // NOTE: storageRef deliberately omitted — that's the only sensitive part.
    })),
    entryHash: entry.entryHash,
    previousEntryHash: entry.previousEntryHash,
    envelopeId: entry.envelopeId,
    traceId: entry.traceId ?? null,
  });
}

function isCustomScope(query: AuditEntriesListQuery): boolean {
  return Boolean(
    query.eventType ||
    query.actorType ||
    query.entityType ||
    query.entityId ||
    query.after ||
    query.before,
  );
}

export async function listAuditEntriesForBrowse(
  ledger: AuditLedger,
  organizationId: string,
  rawQuery: unknown,
): Promise<AuditEntriesListResponse> {
  const query: AuditEntriesListQuery = AuditEntriesListQuerySchema.parse(rawQuery);
  const limit = Math.min(query.limit, MAX_LIMIT);
  // Throws CursorDecodeError on malformed input; the route handler maps that to 400.
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const effectiveScope: "operational" | "all" | "custom" = isCustomScope(query)
    ? "custom"
    : query.scope;

  const eventTypeFilter = query.eventType
    ? [query.eventType]
    : effectiveScope === "operational"
      ? [...OPERATIONAL_AUDIT_EVENT_TYPES]
      : null;

  const filter: AuditLedgerBrowseFilter = {
    organizationId,
    eventTypes: eventTypeFilter,
    actorType: query.actorType ?? null,
    entityType: query.entityType ?? null,
    entityId: query.entityId ?? null,
    after: query.after ? new Date(query.after) : null,
    before: query.before ? new Date(query.before) : null,
    cursor,
    limit: limit + 1, // fetch one extra to compute nextCursor
  };

  const rawRows = await ledger.listForBrowse(filter);

  const trimmed = rawRows.slice(0, limit);
  const hasMore = rawRows.length > limit;
  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ timestamp: last.timestamp.toISOString(), id: last.id }) : null;

  return AuditEntriesListResponseSchema.parse({
    rows: trimmed.map(project),
    nextCursor,
    scope: effectiveScope,
    appliedFilters: {
      eventType: query.eventType ?? null,
      actorType: query.actorType ?? null,
      entityType: query.entityType ?? null,
      entityId: query.entityId ?? null,
      after: query.after ?? null,
      before: query.before ?? null,
    },
  });
}
