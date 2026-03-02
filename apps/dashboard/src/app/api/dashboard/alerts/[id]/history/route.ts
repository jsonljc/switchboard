import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const client = await getApiClient();
    const { id } = await params;
    const data = await client.getAlertHistory(id);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
