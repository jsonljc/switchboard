import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

export async function GET(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const surface = url.searchParams.get("surface");
    if (surface !== "queue" && surface !== "shadow_action") {
      return NextResponse.json(
        { error: "surface required (queue|shadow_action)" },
        { status: 400 },
      );
    }
    const status = url.searchParams.get("status") ?? "pending";
    const since = url.searchParams.get("since") ?? undefined;
    const data = await client.listRecommendations({ surface, status, since });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const body = (await request.json()) as {
      recommendationId?: string;
      action?: string;
      note?: string;
    };
    if (!body.recommendationId) {
      return NextResponse.json({ error: "recommendationId required" }, { status: 400 });
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.recommendationId)
    ) {
      return NextResponse.json({ error: "recommendationId must be a UUID" }, { status: 400 });
    }
    if (!body.action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }
    const result = await client.actOnRecommendation(body.recommendationId, {
      action: body.action as never,
      ...(body.note ? { note: body.note } : {}),
    });
    // actOnRecommendation always returns {status, body} — forward both verbatim
    // so 409 (already-terminal) reaches the hook layer where it is treated as success.
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
