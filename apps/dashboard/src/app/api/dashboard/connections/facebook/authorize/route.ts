import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const apiUrl = process.env.SWITCHBOARD_API_URL;
    if (!apiUrl) {
      return NextResponse.json({ error: "API URL not configured" }, { status: 500 });
    }
    return NextResponse.redirect(
      `${apiUrl}/api/connections/facebook/authorize?deploymentId=${deploymentId}`,
    );
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
