import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { proxyError } from "@/lib/proxy-error";

export async function GET() {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.getBillingStatus();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
