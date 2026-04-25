import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      contactName: string;
      service?: string;
      amount: number;
      date?: string;
    };

    if (!body.contactName?.trim() || !body.amount || body.amount <= 0) {
      return NextResponse.json(
        { error: "contactName and a positive amount are required", statusCode: 400 },
        { status: 400 },
      );
    }

    const client = await getApiClient();

    // Generate a contact ID from the name for the revenue API
    const contactId = `manual-${body.contactName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;

    const data = await client.recordRevenue(session.organizationId, {
      contactId,
      amount: body.amount,
      currency: "SGD",
      type: "payment",
      recordedBy: "owner",
      externalReference: body.service ?? null,
      sourceCampaignId: null,
      sourceAdId: null,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
