import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

const VALID_WINDOWS = new Set(["today", "week", "month"]);

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/**
 * Dashboard proxy for `GET /api/dashboard/agents/:agentId/wins?window=…`.
 *
 * Param name is `agentId` to match sibling routes (Next.js rejects different
 * dynamic-segment slugs at the same path level). The semantic value is an
 * `AgentKey`. Upstream api validates membership + Slice B exclusion (mira → 404).
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const url = new URL(request.url);
    const window = url.searchParams.get("window") ?? "today";
    if (!VALID_WINDOWS.has(window)) {
      return NextResponse.json({ error: "Invalid window" }, { status: 400 });
    }

    await requireDashboardSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const data = await client.listWins(agentId, window as "today" | "week" | "month");
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
