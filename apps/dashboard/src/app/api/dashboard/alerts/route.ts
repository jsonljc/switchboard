import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.listAlerts();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: err.message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.createAlert(body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: err.message === "Unauthorized" ? 401 : 500 },
    );
  }
}
