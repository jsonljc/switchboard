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
 * Dashboard proxy for `GET /api/dashboard/agents/:agentId/pipeline`.
 *
 * Pipeline has no `?window=` query param (unlike wins/metrics) — pipeline is
 * a "current state" view, not a time-windowed aggregation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const data = await client.listPipeline(agentId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
