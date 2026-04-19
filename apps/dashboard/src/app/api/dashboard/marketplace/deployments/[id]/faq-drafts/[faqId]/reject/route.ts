import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> },
) {
  try {
    const { id, faqId } = await params;
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    const client = await getApiClient();
    const data = await client.rejectDraftFAQ(orgId, id, faqId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
