import { describe, it, expect, beforeEach } from "vitest";
import { OrgConcurrencyLimiter } from "../rate-limiter.js";

describe("OrgConcurrencyLimiter", () => {
  let limiter: OrgConcurrencyLimiter;

  beforeEach(() => {
    limiter = new OrgConcurrencyLimiter({ maxConcurrent: 2, queueTimeoutMs: 100 });
  });

  it("allows requests under concurrency limit", async () => {
    const release = await limiter.acquire("org-1");
    expect(release).toBeTypeOf("function");
    release();
  });

  it("queues requests over limit and processes in order", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");

    const p3 = limiter.acquire("org-1");
    r1();
    const r3 = await p3;
    expect(r3).toBeTypeOf("function");
    r2();
    r3();
  });

  it("rejects when queue timeout is exceeded", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");

    await expect(limiter.acquire("org-1")).rejects.toThrow("queue timeout");

    r1();
    r2();
  });

  it("allows independent concurrency for different orgs", async () => {
    const r1 = await limiter.acquire("org-1");
    const r2 = await limiter.acquire("org-1");
    const r3 = await limiter.acquire("org-2");

    expect(r3).toBeTypeOf("function");
    r1();
    r2();
    r3();
  });
});
