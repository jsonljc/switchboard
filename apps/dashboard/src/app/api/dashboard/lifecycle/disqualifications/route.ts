import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

export async function GET() {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.listPendingDisqualifications();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
