import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    // Use a default org ID — in production, this would come from session context
    const orgId = process.env["DEFAULT_ORG_ID"] ?? "default";
    const data = await client.getOrgConfig(orgId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const client = await getApiClient();
    const orgId = process.env["DEFAULT_ORG_ID"] ?? "default";
    const body = await request.json();
    const data = await client.updateOrgConfig(orgId, body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
