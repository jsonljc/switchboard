import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const runtimeType = request.nextUrl.searchParams.get("runtimeType") ?? undefined;
    const data = await client.getIntegrationGuide(session.organizationId, runtimeType);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: err.message === "Unauthorized" ? 401 : 500 },
    );
  }
}
