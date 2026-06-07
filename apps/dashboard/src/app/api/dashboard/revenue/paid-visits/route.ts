import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";
import { REPORT_WINDOWS } from "@switchboard/schemas";
import type { ReportWindow } from "@switchboard/schemas";

/** Map a ReportWindow to an approximate day count for date-range computation. */
const WINDOW_DAYS: Record<ReportWindow, number> = {
  "THIS WEEK": 7,
  "THIS MONTH": 30,
  "THIS QUARTER": 90,
};

function windowToRange(window: string): { from: string; to: string } {
  const days = REPORT_WINDOWS.includes(window as ReportWindow)
    ? WINDOW_DAYS[window as ReportWindow]
    : 90; // unknown/absent → 90-day default
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const window = searchParams.get("window") ?? "";
    const { from, to } = windowToRange(window);
    const client = await getApiClient();
    const data = await client.getPaidVisitsByCampaign(session.organizationId, { from, to });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
