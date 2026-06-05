import { NextRequest, NextResponse } from "next/server";
import { OperationalStateSchema } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.getLatestOperationalState(id);
    return NextResponse.json({ confirmation: data.confirmation ?? null });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = OperationalStateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten(), statusCode: 400 },
        { status: 400 },
      );
    }

    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.recordOperationalState(id, parsed.data);
    return NextResponse.json({ confirmation: data.confirmation }, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
