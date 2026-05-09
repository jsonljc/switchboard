import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const sp = req.nextUrl.searchParams;
    const data = await client.getAutomations({
      status: sp.get("status") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      sort: sp.get("sort") ?? undefined,
      direction: sp.get("direction") ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
