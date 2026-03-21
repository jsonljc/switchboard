import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const raw: unknown = await request.json();

    if (raw === null || typeof raw !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const { amount, contactId, reference } = raw as Record<string, unknown>;

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }

    if (typeof contactId !== "string" || contactId.trim() === "") {
      return NextResponse.json({ error: "contactId must be a non-empty string" }, { status: 400 });
    }

    if (reference !== undefined && typeof reference !== "string") {
      return NextResponse.json(
        { error: "reference must be a string if provided" },
        { status: 400 },
      );
    }

    const body = {
      amount,
      contactId,
      reference: reference as string | undefined,
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
