import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

const PIXEL_ID_PATTERN = /^\d{5,}$/;

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const { pixelId } = body as { pixelId?: unknown };
    if (typeof pixelId !== "string" || !PIXEL_ID_PATTERN.test(pixelId)) {
      return NextResponse.json(
        { error: "pixelId must be a numeric string (5+ digits)" },
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
