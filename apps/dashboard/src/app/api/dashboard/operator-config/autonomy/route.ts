import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const session = await requireSession();
    const client = await getApiClient();

    try {
      const result = await client.getAutonomyAssessment(session.organizationId);
      return NextResponse.json({ assessment: result.assessment });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("404") || message.includes("not found")) {
        return NextResponse.json({ error: "Operator config not found" }, { status: 404 });
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
