import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function GET(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const data = await client.getApproval(id);
      return NextResponse.json(data);
    }
    const data = await client.listPendingApprovals();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const body = await request.json();
    const { approvalId, ...rest } = body;
    const data = await client.respondToApproval(approvalId, rest);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
