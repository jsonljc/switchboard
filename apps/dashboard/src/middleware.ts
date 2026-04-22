import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter for dashboard API routes.
 * Limits per-IP to prevent abuse of the proxy layer.
 * The backend Switchboard API has its own rate limiting;
 * this adds defense-in-depth at the dashboard edge.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // 120 req/min per IP

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

/* ------------------------------------------------------------------ */
/* Public route patterns — no auth required                            */
/* ------------------------------------------------------------------ */
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/agents(\/.*)?$/,
  /^\/get-started$/,
  /^\/how-it-works$/,
  /^\/pricing$/,
  /^\/login$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/api\/waitlist$/,
  /^\/_next(\/.*)?$/,
  /^\/favicon\.ico$/,
  /^\/widget\.js$/,
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((re) => re.test(pathname));
}

/* ------------------------------------------------------------------ */
/* Dev bypass — mirrors the pattern in lib/session.ts                  */
/* ------------------------------------------------------------------ */
function isDevBypass(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production"
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* ---- Auth gate (runs before rate limiting) ---- */
  if (!isPublicRoute(pathname) && !isDevBypass()) {
    // NextAuth v5 JWT strategy stores the session token in this cookie.
    // Checking its presence is the lightweight edge-compatible approach —
    // full session validation happens server-side on each request.
    const sessionToken =
      request.cookies.get("__Secure-authjs.session-token") ??
      request.cookies.get("authjs.session-token");

    if (!sessionToken) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  /* ---- Rate limiting (API routes only) ---- */
  if (!pathname.startsWith("/api/dashboard")) {
    return NextResponse.next();
  }

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

export const config = {
  /*
   * Run middleware on all routes so the auth gate can protect private paths.
   * Static assets served by Next.js (images, fonts, etc.) are excluded via
   * the default `_next/static` and `_next/image` internal handling, but we
   * explicitly include `_next` in PUBLIC_PATTERNS so they pass through the
   * auth check quickly.
   */
  matcher: ["/((?!_next/static|_next/image).*)"],
};
