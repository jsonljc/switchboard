import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function DELETE(_request: NextRequest, { params }: { params: { channelId: string } }) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const data = await client.deleteChannel(session.organizationId, params.channelId);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: err.message === "Unauthorized" ? 401 : 500 },
    );
  }
}
