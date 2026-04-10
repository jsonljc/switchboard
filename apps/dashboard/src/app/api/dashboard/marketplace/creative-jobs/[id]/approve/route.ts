import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body?.action;
    if (action !== "continue" && action !== "stop") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.approveCreativeJobStage(id, action);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
