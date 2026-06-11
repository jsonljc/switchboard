import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    // Server-proxy with the operator's API key so the API authorize leg can verify the org owns
    // this deployment and sign the OAuth state; then redirect the browser to the signed consent URL.
    // (A plain browser redirect to the API would carry no Bearer, leaving the leg unable to gate.)
    const client = await getApiClient();
    const { authorizeUrl } = await client.getFacebookAuthorizeUrl(deploymentId);
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(new URL("/settings?error=connect_failed", request.url));
  }
}
