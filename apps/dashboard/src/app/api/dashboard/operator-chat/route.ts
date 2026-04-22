import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const client = await getApiClient();
    const body = (await request.json()) as { rawInput: string; channel?: string };

    const data = await client.sendOperatorCommand({
      rawInput: body.rawInput,
      channel: body.channel ?? "dashboard",
      operatorId: session.user.email ?? "dashboard-operator",
    });

    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
