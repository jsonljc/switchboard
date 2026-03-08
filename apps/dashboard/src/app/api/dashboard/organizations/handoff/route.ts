import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

/**
 * POST /api/dashboard/organizations/handoff
 *
 * Triggers the post-onboarding handoff:
 * 1. Sends welcome message to the owner's Telegram
 * 2. Triggers strategist agent to analyze the ad account
 * 3. The strategist will send a campaign plan to Telegram for approval
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const body = await request.json();

    const organizationId = body.organizationId || session.organizationId;
    const data = await client.triggerHandoff(organizationId, session.principalId);

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Handoff failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
