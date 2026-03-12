import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function DELETE(_request: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const data = await client.deleteChannel(session.organizationId, params.channelId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
