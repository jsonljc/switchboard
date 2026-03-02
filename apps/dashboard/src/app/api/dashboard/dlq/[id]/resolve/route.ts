import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const client = await getApiClient();
    const data = await client.resolveDlqMessage(params.id);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "Unauthorized" ? 401 : 500 });
  }
}
