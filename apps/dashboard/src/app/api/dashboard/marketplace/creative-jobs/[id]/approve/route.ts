import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body?.action;
    if (action !== "continue" && action !== "stop") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const productionTier = body?.productionTier;
    const client = await getApiClient();
    const data = await client.approveCreativeJobStage(id, action, productionTier);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
