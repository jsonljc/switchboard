import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { MiraBriefRequestSchema } from "@switchboard/schemas";
import { createIdempotencyKey } from "@/lib/idempotency";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Dashboard proxy for `POST /api/dashboard/agents/mira/brief` (createCreativeDraftRequest). */
export async function POST(request: Request) {
  try {
    await requireDashboardSession();
    const parsed = MiraBriefRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid brief" }, { status: 400 });
    // Prefer the browser-supplied key so retries of the SAME submission dedupe.
    const idempotencyKey = request.headers.get("idempotency-key") ?? createIdempotencyKey();
    const client = await getApiClient();
    const data = await client.createCreativeDraftRequest(parsed.data, idempotencyKey);
    // Preserve the governance pending-approval semantics: when the gate PARKS a
    // brief, the API answers 202 PENDING_APPROVAL instead of a submitted draft.
    // Forward the 202 + envelope so the hook surfaces a pending state, not a
    // phantom 201 success. Mirrors the creative-jobs approve proxy.
    if (
      data &&
      typeof data === "object" &&
      "outcome" in data &&
      data.outcome === "PENDING_APPROVAL"
    ) {
      return NextResponse.json(data, { status: 202 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
