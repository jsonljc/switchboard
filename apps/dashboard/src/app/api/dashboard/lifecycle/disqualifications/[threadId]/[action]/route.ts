import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; action: string }> },
) {
  const { threadId, action } = await params;

  if (action !== "confirm" && action !== "dismiss") {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const body = (await request.json().catch(() => ({}))) as { operatorNote?: string };
    const result = await client.resolveDisqualification(threadId, action, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
