import { NextResponse, type NextRequest } from "next/server";
import { REPORT_WINDOWS, type ReportWindow } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

const ALLOWED_WINDOWS: ReadonlySet<ReportWindow> = new Set(REPORT_WINDOWS);

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const raw = req.nextUrl.searchParams.get("window");
    if (!raw || !ALLOWED_WINDOWS.has(raw as ReportWindow)) {
      return NextResponse.json(
        { error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." },
        { status: 400 },
      );
    }
    const client = await getApiClient();
    const data = await client.getReport(raw as ReportWindow);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
