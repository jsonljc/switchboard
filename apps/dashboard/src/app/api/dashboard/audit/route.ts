import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

/**
 * Audit route: always returns 200 with { entries, total } so the UI never breaks.
 * On backend/session failure, returns empty entries and optional error message.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const data = await client.queryAudit({
      eventType: searchParams.get("eventType") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      after: searchParams.get("after") || undefined,
      before: searchParams.get("before") || undefined,
    });
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return NextResponse.json({
      entries,
      total: typeof data?.total === "number" ? data.total : entries.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load activity";
    // Return 200 with empty data so the UI can show a friendly message instead of a hard error
    return NextResponse.json({
      entries: [],
      total: 0,
      error: message,
    });
  }
}
