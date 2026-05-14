import { NextResponse, type NextRequest } from "next/server";
import type { OpportunityStage } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { id } = await params;
    const body = (await req.json()) as { stage?: string };
    const data = await client.patchOpportunityStage(id, (body.stage ?? "") as OpportunityStage);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return proxyError({ error: message }, 401);
    if (/not found/i.test(message)) return proxyError({ error: message }, 404);
    if (/invalid/i.test(message)) return proxyError({ error: message }, 400);
    return proxyError({ error: message }, 500);
  }
}
