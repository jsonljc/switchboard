import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const result = await client.getReadiness(agentId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
