import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const days = url.searchParams.get("days") ?? "1";
    const after = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString();

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
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
