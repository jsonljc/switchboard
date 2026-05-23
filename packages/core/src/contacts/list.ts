import type {
  ContactStore,
  ContactBrowseQuery,
  ContactBrowseResult,
} from "../lifecycle/contact-store.js";
import type {
  ContactsListQuery,
  ContactsListResponse,
  ContactBrowseRow,
} from "@switchboard/schemas";
import type { RouteTemplates } from "../lib/route-templates.js";

/**
 * Thrown when the dashboard hands back a cursor we can't decode. The Fastify
 * route maps this to 400; nothing else should swallow it.
 */
export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";
  constructor(message = "Invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface ListContactsDeps {
  contactStore: Pick<ContactStore, "listForBrowse">;
  routeTemplates: RouteTemplates;
}

/**
 * Read-side projection that backs `GET /api/dashboard/contacts`. Surface-
 * agnostic — it has no idea what page renders the result, only that the
 * caller wants the page-ready row shape.
 */
export async function listContactsForBrowse(
  input: { orgId: string; query: ContactsListQuery },
  deps: ListContactsDeps,
): Promise<ContactsListResponse> {
  const { orgId, query } = input;
  const decodedCursor = query.cursor ? decodeCursor(query.cursor) : undefined;

  const storeQuery: ContactBrowseQuery = {
    orgId,
    stage: query.stage,
    search: query.search,
    sort: query.sort,
    direction: query.direction,
    cursor: decodedCursor,
    limit: query.limit,
  };

  const result: ContactBrowseResult = await deps.contactStore.listForBrowse(storeQuery);

  const rows: ContactBrowseRow[] = result.rows.map((c) => ({
    id: c.id,
    displayName: c.name ?? c.phone ?? c.email ?? "—",
    stage: c.stage,
    primaryChannel: c.primaryChannel,
    source: c.source ?? null,
    lastActivityAt: c.lastActivityAt.toISOString(),
    firstContactAt: c.firstContactAt.toISOString(),
    // The store should already cap at 99; clamping again is a defensive
    // sanity check on the schema bound, not load-bearing.
    opportunityCount: Math.min(result.opportunityCounts.get(c.id) ?? 0, 99),
    detailHref: deps.routeTemplates.contactDetail(c.id),
  }));

  const nextCursor = result.nextKeyset ? encodeCursor(result.nextKeyset) : null;

  return { rows, nextCursor, hasMore: result.hasMore };
}

// ---------------------------------------------------------------------------
// Cursor encoding — opaque base64 over `{ ts: ISO, id }`. The dashboard
// never sees this shape; it round-trips the string back as `?cursor=...`.
// ---------------------------------------------------------------------------

function encodeCursor(k: { ts: Date; id: string }): string {
  const json = JSON.stringify({ ts: k.ts.toISOString(), id: k.id });
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeCursor(s: string): { ts: Date; id: string } {
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
  if (Number.isNaN(date.getTime())) {
    throw new InvalidCursorError();
  }
  return { ts: date, id };
}
