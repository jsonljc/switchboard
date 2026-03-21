import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();

    const baseUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";
    const apiKey = process.env.SWITCHBOARD_API_KEY;

    if (!apiKey) {
      throw new Error("SWITCHBOARD_API_KEY not configured");
    }

    const response = await fetch(`${baseUrl}/agents/wizard-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        organizationId: session.organizationId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "API error" }));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
