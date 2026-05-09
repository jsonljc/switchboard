import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

/**
 * Dashboard proxy for `GET /api/dashboard/contacts/:id` (D1.5). Unlike the
 * list proxy this preserves the upstream HTTP status — `getContact` throws an
 * Error annotated with `.status`, so a 404 from the API for missing/cross-org
 * contactIds surfaces as 404 to the client (not 500). 401 still maps from the
 * `Unauthorized` session error.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const { id } = await params;
    const data = await client.getContact(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return proxyError({ error: err.message }, 401);
    }
    const status =
      err instanceof Error && typeof (err as unknown as { status?: number }).status === "number"
        ? (err as unknown as { status: number }).status
        : 500;
    return proxyError(err instanceof Error ? { error: err.message } : {}, status);
  }
}
