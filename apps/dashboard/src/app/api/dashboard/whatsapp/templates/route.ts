import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import type { WhatsAppCreateTemplateRequest } from "@switchboard/schemas";

// Dashboard proxy for `GET /api/dashboard/whatsapp/templates` — lists WABA templates.
export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const { status, data } = await client.listWhatsAppTemplates();
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

// Dashboard proxy for `POST /api/dashboard/whatsapp/templates` — in-product template
// creation. The upstream status + structured error envelope are forwarded unchanged
// so the create dialog can surface Meta's validation message.
export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const body = (await request.json()) as WhatsAppCreateTemplateRequest;
    const client = await getApiClient();
    const { status, data } = await client.createWhatsAppTemplate(body);
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
