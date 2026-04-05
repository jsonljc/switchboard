import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
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
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
