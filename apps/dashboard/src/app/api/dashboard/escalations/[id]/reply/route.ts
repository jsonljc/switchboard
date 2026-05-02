import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

/**
 * Dashboard proxy for `POST /api/escalations/:id/reply`.
 *
 * The upstream API returns two distinct success-adjacent shapes:
 *   - 200 { escalation, replySent: true } — operator reply persisted AND
 *     proactively delivered through the channel adapter.
 *   - 502 { escalation, replySent: false, error, statusCode } — operator
 *     reply persisted, but channel delivery failed (e.g. notifier missing,
 *     channel transport error). The escalation IS released; the customer
 *     just won't have received the reply yet.
 *
 * Collapsing 502 into a generic 500 (the previous behavior, which used
 * `replyToEscalation()` whose base `request()` throws on every non-ok
 * status) makes the dashboard banner copy on `/escalations` factually
 * incorrect (DC-23). It said "your reply will be delivered when the
 * customer next messages", which was never true — the API only returns
 * 200 after `agentNotifier.sendProactive()` succeeds. The 502 path needs
 * to surface to the operator with branched copy ("couldn't deliver right
 * now") so they can retry or contact the customer directly.
 *
 * Behavior:
 *   - upstream 200 → 200 with upstream body (unchanged).
 *   - upstream 502 → 502 with upstream body verbatim. Hook + UI branches.
 *   - upstream other non-ok → preserved as before via `proxyError(...)`,
 *     since `replyToEscalationRaw` only throws on transport-level failure
 *     and otherwise returns `{ status, body }`. We treat any non-200 /
 *     non-502 status as a true server/auth error and route it through
 *     `proxyError` to keep the existing behavior for callers that aren't
 *     prepared for arbitrary upstream statuses.
 *
 * See `apps/dashboard/src/hooks/use-escalation-reply.ts` for the matching
 * 200/502 branching on the client side.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const body = await request.json();
    const client = await getApiClient();
    const { id } = await params;
    const { status, body: upstream } = await client.replyToEscalationRaw(id, body.message);

    if (status === 200) {
      return NextResponse.json(upstream, { status: 200 });
    }
    if (status === 502) {
      return NextResponse.json(upstream, { status: 502 });
    }
    // Other non-ok upstream statuses go through proxyError so the shape
    // matches the rest of the dashboard proxy fleet.
    return proxyError(upstream, status);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
