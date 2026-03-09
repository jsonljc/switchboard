import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.getOperatorSummary();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load operator summary";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
