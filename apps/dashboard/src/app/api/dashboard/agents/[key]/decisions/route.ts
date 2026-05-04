import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/**
 * Dashboard proxy for `GET /api/agents/:key/decisions` — per-agent Decision Feed.
 * The `key` param is an `AgentKey` (alex|riley|mira); validation lives upstream.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { key } = await params;
    const data = await client.listDecisions(key);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
