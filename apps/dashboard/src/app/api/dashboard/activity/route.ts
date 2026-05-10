import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const sp = req.nextUrl.searchParams;
    const data = await client.getActivity({
      scope: (sp.get("scope") as "operational" | "all") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      eventType: sp.get("eventType") ?? undefined,
      actorType: sp.get("actorType") ?? undefined,
      entityType: sp.get("entityType") ?? undefined,
      entityId: sp.get("entityId") ?? undefined,
      after: sp.get("after") ?? undefined,
      before: sp.get("before") ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
