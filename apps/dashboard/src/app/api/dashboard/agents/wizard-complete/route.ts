import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const client = await getApiClient();

    const result = await client.completeWizard({
      ...body,
      organizationId: session.organizationId,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
