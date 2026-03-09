import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const data = await client.getClinicReport({
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      adSpend: url.searchParams.has("adSpend")
        ? Number(url.searchParams.get("adSpend"))
        : undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
