import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { createIdempotencyKey } from "@/lib/idempotency";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const market = await client.getGovernanceMarket(agentId);
    return NextResponse.json(market);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const payload = (await request.json().catch(() => ({}))) as {
      jurisdiction?: string;
      clinicType?: string;
    };
    // Propagate the backend status + body (409 invalid config carries `reason`, 402
    // entitlement carries `error`) instead of collapsing every non-2xx to a 500.
    const { status, body } = await client.setGovernanceMarketRaw(
      agentId,
      payload.jurisdiction ?? "",
      payload.clinicType ?? "",
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
