import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 100;

    const data = await client.listDlqMessages(status, limit);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
