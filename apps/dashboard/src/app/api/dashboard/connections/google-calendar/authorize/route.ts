import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      // A real deployment is required: the API authorize leg signs a state bound to it and the
      // callback resolves the org from it. (The old "pending" default already 404'd at the callback.)
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    // Server-proxy with the operator's API key so the API authorize leg can verify the org owns
    // this deployment and sign the OAuth state; then redirect the browser to the signed consent URL.
    const client = await getApiClient();
    const { authorizeUrl } = await client.getGoogleCalendarAuthorizeUrl(deploymentId);
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(new URL("/settings?error=connect_failed", request.url));
  }
}
