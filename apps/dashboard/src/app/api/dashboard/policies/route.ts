import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.listPolicies();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.createPolicy(body);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const { id, ...updates } = body;
    const data = await client.updatePolicy(id, updates);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const client = await getApiClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const data = await client.deletePolicy(id);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
