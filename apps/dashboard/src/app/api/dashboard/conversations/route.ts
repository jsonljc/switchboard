import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const data = await client.getConversations({
      status: url.searchParams.get("status") ?? undefined,
      channel: url.searchParams.get("channel") ?? undefined,
      principalId: url.searchParams.get("principalId") ?? undefined,
      limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
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
