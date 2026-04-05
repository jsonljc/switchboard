import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const data = await client.listTasks({ status });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
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
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
