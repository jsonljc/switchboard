import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET() {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const data = await client.getOrgConfig(session.organizationId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.updateOrgConfig(session.organizationId, body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
