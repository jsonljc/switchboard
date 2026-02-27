import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const data = await client.getIdentitySpecByPrincipal(session.principalId);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const { id, ...updates } = body;
    const data = await client.updateIdentitySpec(id, updates);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
