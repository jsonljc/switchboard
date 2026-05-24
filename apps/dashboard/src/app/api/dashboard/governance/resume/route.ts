import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getApiClient } from "@/lib/get-api-client";
import { proxyError } from "@/lib/proxy-error";

/**
 * Dashboard proxy for `POST /api/governance/resume`.
 *
 * The upstream API returns two distinct shapes:
 *   - 200 { resumed: true, profile } — all readiness checks passed; agent
 *     is back in active governance.
 *   - 400 { resumed: false, readiness: { ready: false, checks: [...] },
 *     statusCode: 400 } — one or more blocking checks failed. The `checks`
 *     array carries { id, label, status: "pass"|"fail", message, blocking }
 *     entries that must reach the browser so `useResume` can render readable
 *     "Cannot resume — blockers: <label>, <label>" copy.
 *
 * Collapsing 400 into a generic 500 (the previous behavior, which used
 * `resume()` whose base `request()` helper throws on every non-ok status with
 * `Error("API error: 400")`) swallowed the readiness body entirely, making it
 * impossible to tell the operator WHY resume was rejected.
 *
 * Behavior:
 *   - upstream 200 → 200 with upstream body (unchanged).
 *   - upstream 400 → 400 with upstream body verbatim. Hook surfaces blockers.
 *   - upstream other non-ok → `proxyError(body, status)` to match the proxy
 *     fleet for true server/auth errors.
 *   - transport/auth throw → `proxyError` as before (401 for Unauthorized,
 *     500 otherwise).
 */
export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const client = await getApiClient();
    const { status, body: upstream } = await client.resumeRaw(body);

    if (status === 200) {
      return NextResponse.json(upstream, { status: 200 });
    }
    if (status === 400) {
      // Preserve the 400 + readiness body verbatim so the browser can read
      // the structured check failures and render blocker copy to the operator.
      return NextResponse.json(upstream, { status: 400 });
    }
    // All other non-ok upstream statuses go through proxyError so the shape
    // matches the rest of the dashboard proxy fleet.
    return proxyError(upstream, status);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
