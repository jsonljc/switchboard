import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const data = await client.queryAudit({
      eventType: searchParams.get("eventType") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      after: searchParams.get("after") || undefined,
      before: searchParams.get("before") || undefined,
    });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
