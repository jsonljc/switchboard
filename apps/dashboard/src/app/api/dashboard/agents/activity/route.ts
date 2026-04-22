import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(request: Request) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const daysRaw = parseInt(url.searchParams.get("days") ?? "1");
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 1;
    const after = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [rosterRes, stateRes, auditRes] = await Promise.all([
      client.getAgentRoster(),
      client.getAgentState(),
      client.queryAudit({ after, limit: 200 }),
    ]);

    return NextResponse.json({
      roster: rosterRes.roster,
      states: stateRes.states,
      auditEntries: auditRes.entries,
    });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
