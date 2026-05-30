import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

const BodySchema = z.object({ decision: z.enum(["kept", "passed"]).nullable() });

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Proxy for Mira Keep/Pass review decision. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireDashboardSession();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    const client = await getApiClient();
    const { id } = await params;
    const data = await client.setCreativeReviewDecision(id, parsed.data.decision);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
