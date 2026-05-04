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
 * Dashboard proxy for `GET /api/agents/:agentId/decisions` — per-agent Decision Feed.
 *
 * Param name is `agentId` to match the sibling `[agentId]/readiness/route.ts`
 * route — Next.js rejects different dynamic-segment slugs at the same path
 * level. The semantic value is an `AgentKey` (alex|riley|mira); the
 * upstream `apps/api/src/routes/decisions.ts` handler validates it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const data = await client.listDecisions(agentId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
