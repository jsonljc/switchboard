import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function GET(request: NextRequest) {
  try {
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json(
        { error: "deploymentId is required", statusCode: 400 },
        { status: 400 },
      );
    }
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.listCreativeJobs({ deploymentId });
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
    const data = await client.submitCreativeBrief(body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
