import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function GET(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const type = request.nextUrl.searchParams.get("type") ?? undefined;
    const limit = request.nextUrl.searchParams.get("limit") ?? undefined;
    const offset = request.nextUrl.searchParams.get("offset") ?? undefined;
    const data = await client.listMarketplaceListings({
      status,
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
