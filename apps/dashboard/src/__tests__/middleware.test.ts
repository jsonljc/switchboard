import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("dashboard middleware auth", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevBypass = process.env.DEV_BYPASS_AUTH;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    delete process.env.DEV_BYPASS_AUTH;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).DEV_BYPASS_AUTH = originalDevBypass;
  });

  it("allows protected routes when the dev bypass is enabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DEV_BYPASS_AUTH = "true";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/settings"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated protected routes when the bypass is disabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/settings"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("does not gate /console (route removed in c2b — middleware matcher excludes it)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    // /console is no longer in AUTH_PAGE_PREFIXES or config.matcher after C2b.
    // Middleware passes the request through without redirecting to /login.
    const response = middleware(new NextRequest("http://localhost/console"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /dashboard (legacy route removed in D4+D5)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    // /dashboard is no longer in AUTH_PAGE_PREFIXES after D4+D5 retirement.
    // Middleware passes the request through without redirecting to /login.
    const response = middleware(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /escalations (legacy route removed in D4+D5)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    // /escalations is no longer in AUTH_PAGE_PREFIXES after D4+D5 retirement.
    const response = middleware(new NextRequest("http://localhost/escalations"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /conversations (legacy route removed in D4+D5)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    // /conversations is no longer in AUTH_PAGE_PREFIXES after D4+D5 retirement.
    const response = middleware(new NextRequest("http://localhost/conversations"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated /reports to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/reports"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /contacts to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/contacts"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /automations to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/automations"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  // P0-A: Home, Inbox, Results, Alex, Riley are now auth-gated.
  it("redirects unauthenticated / (Home) to /login (exact match, not prefix)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /inbox to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/inbox"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /results to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/results"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /alex to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/alex"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /riley to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/riley"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  // Public paths must STAY public — the root exact-match must NOT bleed into them.
  it("does not gate /welcome (public marketing path)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/welcome"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /privacy (public legal path)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/privacy"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /terms (public legal path)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/terms"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /login (auth flow)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("auth-mutation rate limiting", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  const forgot = (ip: string) =>
    new NextRequest("http://localhost/api/auth/forgot-password", {
      headers: { "x-forwarded-for": ip },
    });

  it("keeps /api/auth/forgot-password public (no login redirect)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const { middleware } = await import("../middleware");

    const response = middleware(forgot("9.9.9.9"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("429s after the per-IP limit on forgot-password", async () => {
    const { middleware } = await import("../middleware");

    for (let i = 0; i < 10; i++) {
      expect(middleware(forgot("5.5.5.5")).status).toBe(200);
    }
    expect(middleware(forgot("5.5.5.5")).status).toBe(429);
  });

  it("tracks each IP independently", async () => {
    const { middleware } = await import("../middleware");

    for (let i = 0; i < 11; i++) middleware(forgot("5.5.5.5"));
    // a different IP is unaffected by the first IP's exhausted budget
    expect(middleware(forgot("7.7.7.7")).status).toBe(200);
  });

  it("also throttles reset-password", async () => {
    const { middleware } = await import("../middleware");
    const reset = () =>
      middleware(
        new NextRequest("http://localhost/api/auth/reset-password", {
          headers: { "x-forwarded-for": "6.6.6.6" },
        }),
      );

    for (let i = 0; i < 10; i++) expect(reset().status).toBe(200);
    expect(reset().status).toBe(429);
  });

  const waitlist = (ip: string) =>
    new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });

  it("keeps /api/waitlist public (no login redirect)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const { middleware } = await import("../middleware");

    const response = middleware(waitlist("9.9.9.10"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("429s after the per-IP limit on /api/waitlist", async () => {
    const { middleware } = await import("../middleware");

    for (let i = 0; i < 10; i++) {
      expect(middleware(waitlist("5.5.5.6")).status).toBe(200);
    }
    expect(middleware(waitlist("5.5.5.6")).status).toBe(429);
  });
});
