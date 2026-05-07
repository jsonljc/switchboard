import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";
import { isValidPixelId } from "@/lib/validation/pixel";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const pixelId = body.pixelId;
    if (typeof pixelId !== "string" || !isValidPixelId(pixelId)) {
      return NextResponse.json(
        { error: "pixelId must be a 15–16 digit numeric string" },
        { status: 400 },
      );
    }
    const client = await getApiClient();
    const data = await client.setMetaPixelId(id, pixelId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
