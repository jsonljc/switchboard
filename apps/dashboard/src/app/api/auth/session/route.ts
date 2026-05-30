// @route-class: ingress-receiver
import { NextRequest, NextResponse } from "next/server";
import { isDevBypassEnabled, getDevDashboardSession } from "@/lib/dev-auth";
import { handlers } from "@/lib/auth";

// Dev-bypass makes the SERVER session synthetic (see getServerSession), but
// NextAuth's own `/api/auth/session` has no real cookie and returns null. The
// client SessionProvider fetches that endpoint and would then flip
// `useSession()` to "unauthenticated", redirecting client-guarded pages (e.g.
// /settings/*) to /login even though the server considers the dev user signed
// in. Under dev-bypass we return the same synthetic session so the client
// agrees with the server. In every other case we delegate to NextAuth's real
// handler, so production behavior (cookies, rolling expiry) is unchanged.
// This static segment takes precedence over the [...nextauth] catch-all for
// `/api/auth/session` only; all other `/api/auth/*` routes are unaffected.
export async function GET(request: NextRequest) {
  if (isDevBypassEnabled()) {
    return NextResponse.json(getDevDashboardSession());
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  return handlers.POST(request);
}
