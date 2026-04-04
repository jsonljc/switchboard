import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.submitTaskOutput(id, body.output);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
