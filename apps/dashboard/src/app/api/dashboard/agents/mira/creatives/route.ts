import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Dashboard proxy for `GET /api/dashboard/agents/mira/creatives` (review feed). */
export async function GET(request: Request) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const data = await client.listMiraCreatives(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
