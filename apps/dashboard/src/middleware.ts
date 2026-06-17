import { NextRequest, NextResponse } from "next/server";
import { isDevBypassEnabled } from "@/lib/dev-auth";

/**
 * Simple in-memory rate limiter for dashboard API routes.
 * Limits per-IP to prevent abuse of the proxy layer.
 * The backend Switchboard API has its own rate limiting;
 * this adds defense-in-depth at the dashboard edge.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // 120 req/min per IP
// Authenticated route prefixes that require a session cookie.
// `/automations` is forward-compat for slice D2b's frontend page which has not
// shipped yet (D2a backend has). Keep both this list and the matcher below in
// sync so D2b can land without touching middleware.
// NOTE: "/" (root) is NOT in this list — a bare "/" prefix would match every
// path. Root auth is handled by a dedicated exact-match check below.
const AUTH_PAGE_PREFIXES = [
  "/marketplace",
  "/deploy",
  "/settings",
  "/onboarding",
  "/post-auth",
  "/reports",
  "/contacts",
  "/automations",
  "/alex",
  "/riley",
  "/inbox",
  "/results",
] as const;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitEntry>();

// Public, unauthenticated mutation endpoints (forgot/reset password, waitlist
// signup) get a much tighter per-IP cap than the general dashboard proxy — they
// trigger email sends + DB writes and are a natural abuse target. The waitlist
// route is an unauthenticated public DB write, so it needs the same throttle.
// Separate map so the two budgets don't bleed into each other.
const AUTH_MUTATION_MAX_REQUESTS = 10;
const AUTH_MUTATION_PATHS = new Set([
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/waitlist",
]);
const authIpMap = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipMap) {
    if (now > entry.resetAt) {
      ipMap.delete(ip);
    }
  }
  for (const [ip, entry] of authIpMap) {
    if (now > entry.resetAt) {
      authIpMap.delete(ip);
    }
  }
}, WINDOW_MS);

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/dashboard/health")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/dashboard")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const now = Date.now();
    let entry = ipMap.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      ipMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
          },
        },
      );
    }

    return NextResponse.next();
  }

  // Tighter per-IP throttle for unauthenticated auth-mutation endpoints.
  if (AUTH_MUTATION_PATHS.has(pathname)) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const now = Date.now();
    let entry = authIpMap.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      authIpMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > AUTH_MUTATION_MAX_REQUESTS) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
          },
        },
      );
    }

    return NextResponse.next();
  }

  // Root "/" requires an exact match — adding it as a prefix would gate every
  // path including public /welcome, /privacy, /terms, /login.
  const isAuthPage =
    pathname === "/" ||
    AUTH_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isAuthPage) {
    if (isDevBypassEnabled()) {
      return NextResponse.next();
    }

    const sessionToken =
      request.cookies.get("__Secure-authjs.session-token")?.value ??
      request.cookies.get("authjs.session-token")?.value;

    if (!sessionToken) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/api/dashboard/:path*",
    "/marketplace/:path*",
    "/deploy/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/post-auth/:path*",
    "/reports/:path*",
    "/contacts/:path*",
    "/automations/:path*",
    "/alex/:path*",
    "/riley/:path*",
    "/inbox/:path*",
    "/results/:path*",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/waitlist",
  ],
};
