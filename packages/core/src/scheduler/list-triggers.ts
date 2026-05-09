import type {
  ScheduledTrigger,
  ScheduledTriggersListQuery,
  ScheduledTriggersListResponse,
  ScheduledTriggerBrowseRow,
} from "@switchboard/schemas";
import type { TriggerStore, TriggerBrowseQuery, TriggerBrowseCursor } from "./trigger-store.js";

/**
 * Thrown when the dashboard hands back a cursor we can't decode. The Fastify
 * route maps this to 400.
 */
export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";
  constructor(message = "Invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface ListTriggersDeps {
  triggerStore: Pick<TriggerStore, "listForBrowse">;
}

/**
 * Allowlist of `action.payload` key names the drawer is permitted to surface.
 * Any other key is rolled into `redactedKeyCount`. Lives here (not in schemas)
 * because it's a backend-only redaction policy — clients only see the
 * post-redaction projection.
 */
export const VISIBLE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "workflowId",
  "contactId",
  "eventType",
  "agentKey",
  "triggerId",
  "source",
]);

export async function listTriggersForBrowse(
  input: { orgId: string; query: ScheduledTriggersListQuery },
  deps: ListTriggersDeps,
): Promise<ScheduledTriggersListResponse> {
  const { orgId, query } = input;
  const decodedCursor = query.cursor ? decodeCursor(query.cursor) : undefined;

  const storeQuery: TriggerBrowseQuery = {
    orgId,
    status: query.status,
    sort: query.sort,
    direction: query.direction,
    cursor: decodedCursor,
    limit: query.limit,
  };

  const result = await deps.triggerStore.listForBrowse(storeQuery);

  const hasMore = result.rows.length > query.limit;
  const kept = hasMore ? result.rows.slice(0, query.limit) : result.rows;

  const rows: ScheduledTriggerBrowseRow[] = kept.map(projectRow);

  const last = kept[kept.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ts: last.createdAt, id: last.id }) : null;

  return {
    rows,
    statusCounts: result.statusCounts,
    nextCursor,
    hasMore,
  };
}

function projectRow(t: ScheduledTrigger): ScheduledTriggerBrowseRow {
  const payload = isRecord(t.action.payload) ? t.action.payload : {};
  const allKeys = Object.keys(payload);
  const visibleActionPayloadKeys = allKeys.filter((k) => VISIBLE_PAYLOAD_KEYS.has(k));
  const redactedKeyCount = allKeys.length - visibleActionPayloadKeys.length;

  return {
    id: t.id,
    type: t.type,
    status: t.status,
    scheduleLabel: scheduleLabel(t),
    actionType: t.action.type,
    sourceWorkflowId: t.sourceWorkflowId,
    createdAt: t.createdAt.toISOString(),
    fireAt: t.fireAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    drawer: {
      eventPatternSummary: eventPatternSummary(t),
      visibleActionPayloadKeys,
      redactedKeyCount,
    },
  };
}

function scheduleLabel(t: ScheduledTrigger): string {
  switch (t.type) {
    case "cron":
      return t.cronExpression ?? "cron:unknown";
    case "timer":
      return t.fireAt?.toISOString() ?? "timer:unknown";
    case "event_match":
      return `event:${t.eventPattern?.type ?? "unknown"}`;
  }
}

function eventPatternSummary(t: ScheduledTrigger): string | null {
  if (t.type !== "event_match" || !t.eventPattern) return null;
  const filterKeys = Object.keys(t.eventPattern.filters ?? {});
  if (filterKeys.length === 0) return `${t.eventPattern.type} (no filters)`;
  return `${t.eventPattern.type} (filters: ${filterKeys.join(", ")})`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Cursor encoding — opaque base64 over `{ ts: ISO, id }`. The dashboard never
// sees this shape; it round-trips the string back as `?cursor=...`.
// ---------------------------------------------------------------------------

function encodeCursor(k: TriggerBrowseCursor): string {
  const json = JSON.stringify({ ts: k.ts.toISOString(), id: k.id });
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeCursor(s: string): TriggerBrowseCursor {
  let raw: string;
  try {
    raw = Buffer.from(s, "base64").toString("utf8");
  } catch {
    throw new InvalidCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidCursorError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { ts?: unknown }).ts !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    throw new InvalidCursorError();
  }
  const { ts, id } = parsed as { ts: string; id: string };
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) throw new InvalidCursorError();
  return { ts: date, id };
}
