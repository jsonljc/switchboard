import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> },
) {
  try {
    const { id, faqId } = await params;
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.rejectDraftFAQ(orgId, id, faqId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
