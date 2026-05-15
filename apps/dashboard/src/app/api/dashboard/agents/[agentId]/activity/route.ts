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
 * Dashboard proxy for `GET /api/dashboard/agents/:agentKey/activity`.
 *
 * Param name is `agentId` to match the sibling per-agent routes — Next.js
 * rejects different dynamic-segment slugs at the same path level.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const expandPreview = url.searchParams.get("expandPreview");

    const data = await client.getAgentActivityCockpit(agentId, {
      limit: limit ? Number(limit) : undefined,
      expandPreview: expandPreview === "false" ? false : true,
    });

    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
