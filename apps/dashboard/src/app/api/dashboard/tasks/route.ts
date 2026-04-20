import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function PATCH(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const { taskId, status } = body;
    const data = await client.updateTask(taskId, { status });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
