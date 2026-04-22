import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter for dashboard API routes.
 * Limits per-IP to prevent abuse of the proxy layer.
 * The backend Switchboard API has its own rate limiting;
 * this adds defense-in-depth at the dashboard edge.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // 120 req/min per IP
const AUTH_PAGE_PREFIXES = [
  "/dashboard",
  "/marketplace",
  "/deploy",
  "/deployments",
  "/settings",
  "/onboarding",
  "/decide",
  "/me",
  "/my-agent",
  "/tasks",
] as const;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipMap) {
    if (now > entry.resetAt) {
      ipMap.delete(ip);
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

  const isAuthPage = AUTH_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isAuthPage) {
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
    "/api/dashboard/:path*",
    "/dashboard/:path*",
    "/marketplace/:path*",
    "/deploy/:path*",
    "/deployments/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/decide/:path*",
    "/me/:path*",
    "/my-agent/:path*",
    "/tasks/:path*",
  ],
};
