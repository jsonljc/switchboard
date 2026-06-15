import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = (await request.json()) as {
      code?: string;
      esToken?: string;
      wabaId?: string;
      phoneNumberId?: string;
      pin?: string;
    };
    // getApiClient attaches the operator's Bearer; the onboard route resolves the
    // org from that auth context (it 403s without an org binding), so a raw
    // unauthenticated fetch — what this route did before — could never onboard.
    const client = await getApiClient();
    const { status, data } = await client.onboardWhatsAppEmbedded(body);
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return proxyError({ error: message }, 401);
    return proxyError({ error: message }, 500);
  }
}
