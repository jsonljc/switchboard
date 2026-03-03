import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || undefined;
    const days = searchParams.get("days") ? Number(searchParams.get("days")) : undefined;

    // If days param is present, fetch trend data
    if (days !== undefined) {
      const data = await client.getTokenUsageTrend({ days });
      return NextResponse.json(data);
    }

    // Otherwise fetch summary
    const data = await client.getTokenUsage({ period });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: err.message === "Unauthorized" ? 401 : 500 },
    );
  }
}
