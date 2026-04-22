import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const session = await requireSession();
    const { channelId } = await params;
    const client = await getApiClient();
    const data = await client.deleteChannel(session.organizationId, channelId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
