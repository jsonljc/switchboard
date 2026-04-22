import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const body = await request.json();
    const client = await getApiClient();
    const result = await client.createCorrection(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
