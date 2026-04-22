import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const { id } = await params;
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json(
        { error: "deploymentId query param required", statusCode: 400 },
        { status: 400 },
      );
    }
    const client = await getApiClient();
    const data = await client.disconnectChannel(deploymentId, id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
