import { NextResponse, type NextRequest } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { id } = await params;
    const body = (await req.json()) as { pageId?: string };
    const data = await client.setMetaPageId(id, body.pageId ?? "");
    return NextResponse.json(data);
  } catch (err: unknown) {
    // The api-client discards the upstream HTTP status (core.ts throws Error(body.error)),
    // so recover the status from the backend's error copy in apps/api/src/routes/connections.ts.
    // Keep these matchers in sync with those messages; an unmatched message degrades safely to
    // 500 with the original (non-sensitive) text preserved.
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return proxyError({ error: message }, 401);
    if (/organization context/i.test(message)) return proxyError({ error: message }, 403);
    if (/not found/i.test(message)) return proxyError({ error: message }, 404);
    if (/page id|not a meta ads/i.test(message)) return proxyError({ error: message }, 400);
    if (/encryption is not configured|database not available/i.test(message)) {
      return proxyError({ error: message }, 503);
    }
    return proxyError({ error: message }, 500);
  }
}
