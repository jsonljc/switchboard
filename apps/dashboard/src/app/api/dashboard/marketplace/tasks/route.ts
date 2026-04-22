import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const deploymentId = request.nextUrl.searchParams.get("deploymentId") ?? undefined;
    const data = await client.listTasks({ status, deploymentId });
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
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.createTask(body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
