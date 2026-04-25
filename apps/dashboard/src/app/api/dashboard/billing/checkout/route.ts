import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    const session = await requireDashboardSession();
    const client = await getApiClient();
    const body = (await request.json()) as { priceId: string };

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3002";
    const data = await client.createCheckout(body.priceId, {
      email: session.user?.email ?? "",
      successUrl: `${baseUrl}/settings/billing?checkout=success`,
      cancelUrl: `${baseUrl}/settings/billing?checkout=canceled`,
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
