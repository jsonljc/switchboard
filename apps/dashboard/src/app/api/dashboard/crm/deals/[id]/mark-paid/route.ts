import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = (await request.json()) as {
      amount: number;
      contactId: string;
      reference?: string;
    };

    const client = await getApiClient();

    // 1. Update deal stage to "won" with amount
    await client.updateDeal(id, { stage: "won", amount: body.amount });

    // 2. Create revenue event
    await client.createRevenueEvent({
      contactId: body.contactId,
      amount: body.amount,
      currency: "USD",
      source: "manual",
      reference: body.reference ?? `marked-paid-dashboard-${id}`,
      recordedBy: session.user.email,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
