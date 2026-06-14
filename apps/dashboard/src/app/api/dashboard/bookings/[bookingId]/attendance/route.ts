import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { createIdempotencyKey } from "@/lib/idempotency";
import { proxyError } from "@/lib/proxy-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { bookingId } = await params;
    const session = await requireSession();
    const body = (await request.json()) as {
      outcome: "attended" | "no_show";
      recordedBy?: "owner" | "staff";
    };
    const idempotencyKey = request.headers.get("idempotency-key") ?? createIdempotencyKey();
    const client = await getApiClient();
    const result = await client.recordAttendance(
      session.organizationId,
      bookingId,
      body,
      idempotencyKey,
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
