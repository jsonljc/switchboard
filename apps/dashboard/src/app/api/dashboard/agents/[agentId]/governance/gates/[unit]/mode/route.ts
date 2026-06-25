import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { createIdempotencyKey } from "@/lib/idempotency";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string; unit: string }> },
) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { agentId, unit } = await params;
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const result = await client.setGovernanceGateMode(
      agentId,
      unit,
      body.mode ?? "",
      createIdempotencyKey(),
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
