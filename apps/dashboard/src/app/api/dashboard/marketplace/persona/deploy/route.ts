import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: Request) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const result = await client.deploySalesPipeline(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Deploy persona error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
