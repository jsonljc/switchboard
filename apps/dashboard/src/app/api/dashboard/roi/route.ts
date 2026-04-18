import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const breakdown = searchParams.get("breakdown") ?? "campaign";

    const apiUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";
    const orgId = session.organizationId;

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("breakdown", breakdown);

    const response = await fetch(`${apiUrl}/api/${orgId}/roi/summary?${params.toString()}`);

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: text }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
