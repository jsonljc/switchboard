import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);

    const data = await client.getRoiSummary(session.organizationId, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      breakdown: searchParams.get("breakdown") ?? "campaign",
    });

    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
