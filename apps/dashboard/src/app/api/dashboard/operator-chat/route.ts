import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { rawInput: string; channel?: string };

    const apiUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";
    const apiKey = process.env.SWITCHBOARD_API_KEY || "";

    const res = await fetch(`${apiUrl}/api/operator/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "x-organization-id": session.organizationId,
      },
      body: JSON.stringify({
        rawInput: body.rawInput,
        channel: body.channel ?? "dashboard",
        operatorId: session.user.email ?? "dashboard-operator",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ error: "API error", details: errBody }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[OperatorChat] route error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
