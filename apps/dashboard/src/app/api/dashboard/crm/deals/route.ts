import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const data = await client.getDeals({
      stage: url.searchParams.get("stage") ?? undefined,
      contactId: url.searchParams.get("contactId") ?? undefined,
      limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
