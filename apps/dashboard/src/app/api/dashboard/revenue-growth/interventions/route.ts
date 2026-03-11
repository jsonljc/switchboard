import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.listRevGrowthInterventions(accountId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load interventions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action: "approve" | "defer";
      interventionId: string;
      reason?: string;
    };

    if (!body.interventionId || !body.action) {
      return NextResponse.json(
        { error: "interventionId and action are required" },
        { status: 400 },
      );
    }

    const client = await getApiClient();

    if (body.action === "approve") {
      const data = await client.approveRevGrowthIntervention(body.interventionId);
      return NextResponse.json(data);
    }

    if (body.action === "defer") {
      const data = await client.deferRevGrowthIntervention(
        body.interventionId,
        body.reason ?? "No reason provided",
      );
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process intervention action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
