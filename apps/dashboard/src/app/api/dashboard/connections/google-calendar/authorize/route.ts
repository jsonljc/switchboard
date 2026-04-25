import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const deploymentId = request.nextUrl.searchParams.get("deploymentId") ?? "pending";
    const apiUrl = process.env.SWITCHBOARD_API_URL;
    if (!apiUrl) {
      return NextResponse.json({ error: "API URL not configured" }, { status: 500 });
    }
    return NextResponse.redirect(
      `${apiUrl}/api/connections/google-calendar/authorize?deploymentId=${deploymentId}`,
    );
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
