import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function PUT(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const result = await client.goLiveAgent(agentId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
