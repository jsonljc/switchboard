import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("assertSafeSelfApprovalEnv", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSelfApproval = process.env.ALLOW_SELF_APPROVAL;
  const originalAck = process.env.ALLOW_SELF_APPROVAL_IN_PRODUCTION;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ALLOW_SELF_APPROVAL;
    delete process.env.ALLOW_SELF_APPROVAL_IN_PRODUCTION;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    (process.env as Record<string, string | undefined>).ALLOW_SELF_APPROVAL = originalSelfApproval;
    (process.env as Record<string, string | undefined>).ALLOW_SELF_APPROVAL_IN_PRODUCTION =
      originalAck;
    vi.restoreAllMocks();
  });

  it("throws in production when ALLOW_SELF_APPROVAL is on without acknowledgement", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ALLOW_SELF_APPROVAL = "true";

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    // The message must name both flags so the operator knows how to resolve it.
    expect(() => assertSafeSelfApprovalEnv()).toThrow(/ALLOW_SELF_APPROVAL/);
    expect(() => assertSafeSelfApprovalEnv()).toThrow(/ALLOW_SELF_APPROVAL_IN_PRODUCTION/);
  });

  it("does not throw in production when acknowledged, and warns", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ALLOW_SELF_APPROVAL = "true";
    process.env.ALLOW_SELF_APPROVAL_IN_PRODUCTION = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    expect(() => assertSafeSelfApprovalEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not throw outside production even when ALLOW_SELF_APPROVAL is on", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.ALLOW_SELF_APPROVAL = "true";

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    expect(() => assertSafeSelfApprovalEnv()).not.toThrow();
  });

  it("does not throw in production when ALLOW_SELF_APPROVAL is unset", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    expect(() => assertSafeSelfApprovalEnv()).not.toThrow();
  });

  it("trips on any non-empty ALLOW_SELF_APPROVAL value, matching the route reads", async () => {
    // Routes use !!process.env.ALLOW_SELF_APPROVAL, so "false" is a truthy
    // non-empty string that ENABLES self-approval at runtime. The guard must
    // catch it too, otherwise it would be weaker than the flag it protects.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ALLOW_SELF_APPROVAL = "false";

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    expect(() => assertSafeSelfApprovalEnv()).toThrow(/ALLOW_SELF_APPROVAL_IN_PRODUCTION/);
  });

  it('requires the acknowledgement to be exactly "true" (fails closed otherwise)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ALLOW_SELF_APPROVAL = "true";
    process.env.ALLOW_SELF_APPROVAL_IN_PRODUCTION = "1";

    const { assertSafeSelfApprovalEnv } = await import("./self-approval-env.js");

    expect(() => assertSafeSelfApprovalEnv()).toThrow(/ALLOW_SELF_APPROVAL_IN_PRODUCTION/);
  });
});
