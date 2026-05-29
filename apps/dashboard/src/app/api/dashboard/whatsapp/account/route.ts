import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

// Dashboard proxy for `GET /api/dashboard/whatsapp/account` — WABA connection +
// readiness. Forwards the upstream status so the page can render the right state.
export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const { status, data } = await client.getWhatsAppAccount();
    return NextResponse.json(data, { status });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
