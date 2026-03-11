import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.getRevGrowthLatest(accountId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load diagnostic";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { accountId?: string };
    if (!body.accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.runRevGrowthDiagnostic(body.accountId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run diagnostic";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
