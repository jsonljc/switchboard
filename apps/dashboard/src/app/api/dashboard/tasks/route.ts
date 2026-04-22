import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const { taskId, status } = body;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required", statusCode: 400 }, { status: 400 });
    }

    const data = await client.updateTask(session.organizationId, taskId, { status });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
