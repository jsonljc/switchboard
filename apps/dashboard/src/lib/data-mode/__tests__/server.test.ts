// apps/dashboard/src/lib/data-mode/__tests__/server.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock server-only (side-effect import before anything loads server.ts)
vi.mock("server-only", () => ({}));

// Mock next/headers cookies(). Each test sets the cookieValue ref to control
// what the mocked store returns.
const cookieValueRef: { current: string | undefined } = { current: undefined };

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "sw.data-mode" && cookieValueRef.current !== undefined
        ? { name, value: cookieValueRef.current }
        : undefined,
  })),
}));

// Snapshot specific keys this suite mutates so afterEach can restore them.
// process.env is a shared Node-process object — mutations leak across files
// without explicit per-key cleanup.
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const envWritable = process.env as Record<string, string | undefined>;

beforeEach(() => {
  cookieValueRef.current = undefined;
});

afterEach(() => {
  delete envWritable.NODE_ENV;
  delete envWritable.VERCEL_ENV;
  if (originalNodeEnv !== undefined) envWritable.NODE_ENV = originalNodeEnv;
  if (originalVercelEnv !== undefined) envWritable.VERCEL_ENV = originalVercelEnv;
});

describe("getDataMode", () => {
  it("returns 'demo' when cookie='demo' and env allows fixture mode", async () => {
    envWritable.NODE_ENV = "development";
    delete envWritable.VERCEL_ENV;
    cookieValueRef.current = "demo";

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("demo");
  });

  it("returns 'live' when cookie is missing", async () => {
    envWritable.NODE_ENV = "development";
    delete envWritable.VERCEL_ENV;
    cookieValueRef.current = undefined;

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("live");
  });

  it("threads process.env through to resolveDataMode (production lock honored)", async () => {
    envWritable.NODE_ENV = "production";
    envWritable.VERCEL_ENV = "production";
    cookieValueRef.current = "demo";

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("live");
  });
});
