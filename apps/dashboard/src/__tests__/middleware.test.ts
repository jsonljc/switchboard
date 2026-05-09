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

    const response = middleware(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated protected routes when the bypass is disabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/dashboard"));

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

  it("redirects unauthenticated /escalations to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/escalations"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /conversations to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/conversations"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects unauthenticated /reports to /login", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { middleware } = await import("../middleware");

    const response = middleware(new NextRequest("http://localhost/reports"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});
