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
    const payload = (await request.json().catch(() => ({}))) as { mode?: string };
    // Propagate the backend status + body (a 409 REFUSE carries a human `reason`) instead
    // of collapsing every non-2xx to a 500.
    const { status, body } = await client.setGovernanceGateModeRaw(
      agentId,
      unit,
      payload.mode ?? "",
      createIdempotencyKey(),
    );
    return NextResponse.json(body, { status });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
