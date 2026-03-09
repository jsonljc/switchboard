import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.setConversationOverride(params.id, body.override ?? true);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
