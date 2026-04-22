import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? "pending";
    const result = await client.listEscalations(status);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
