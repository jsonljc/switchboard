import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeMetaTokenRefresh } from "../meta-token-refresh.js";
import type { MetaTokenRefreshDeps, StepTools } from "../meta-token-refresh.js";
import { encryptCredentials } from "@switchboard/db";

function makeStep(): StepTools {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()) as StepTools["run"],
  };
}

function makeDeps(overrides: Partial<MetaTokenRefreshDeps> = {}): MetaTokenRefreshDeps {
  return {
    listMetaConnections: vi.fn().mockResolvedValue([]),
    updateCredentials: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    refreshTokenIfNeeded: vi.fn().mockResolvedValue(null),
    getOAuthConfig: vi.fn().mockReturnValue({
      appId: "app_123",
      appSecret: "secret_123",
      redirectUri: "https://example.com/callback",
    }),
    ...overrides,
  };
}

function encryptTestCreds(creds: Record<string, unknown>): string {
  return encryptCredentials(creds, "test-master-key-that-is-at-least-32-chars!");
}

describe("executeMetaTokenRefresh", () => {
  // Set the encryption key for tests
  const originalEnv = process.env["CREDENTIALS_ENCRYPTION_KEY"];
  beforeAll(() => {
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = "test-master-key-that-is-at-least-32-chars!";
  });
  afterAll(() => {
    if (originalEnv) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = originalEnv;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  it("returns zero counts when no connections exist", async () => {
    const step = makeStep();
    const deps = makeDeps();

    const result = await executeMetaTokenRefresh(step, deps);

    expect(result).toEqual({ checked: 0, refreshed: 0, failed: 0 });
  });

  it("skips connections not expiring within threshold", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out
    const creds = encryptTestCreds({
      accessToken: "token_abc",
      tokenExpiresAt: futureDate.toISOString(),
      accountId: "act_123",
    });

    const deps = makeDeps({
      listMetaConnections: vi.fn().mockResolvedValue([
        {
          id: "conn_1",
          deploymentId: "dep_1",
          type: "meta-ads",
          status: "active",
          credentials: creds,
          metadata: null,
        },
      ]),
    });

    const result = await executeMetaTokenRefresh(makeStep(), deps);

    expect(result.checked).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(deps.refreshTokenIfNeeded).not.toHaveBeenCalled();
  });

  it("refreshes tokens expiring within threshold", async () => {
    const soonDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days out
    const creds = encryptTestCreds({
      accessToken: "old_token",
      tokenExpiresAt: soonDate.toISOString(),
      accountId: "act_123",
    });

    const deps = makeDeps({
      listMetaConnections: vi.fn().mockResolvedValue([
        {
          id: "conn_1",
          deploymentId: "dep_1",
          type: "meta-ads",
          status: "active",
          credentials: creds,
          metadata: null,
        },
      ]),
      refreshTokenIfNeeded: vi.fn().mockResolvedValue({
        accessToken: "new_token",
        expiresIn: 5184000,
      }),
    });

    const result = await executeMetaTokenRefresh(makeStep(), deps);

    expect(result.refreshed).toBe(1);
    expect(deps.updateCredentials).toHaveBeenCalledOnce();
  });

  it("marks connection as needs_reauth on failure", async () => {
    const soonDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const creds = encryptTestCreds({
      accessToken: "old_token",
      tokenExpiresAt: soonDate.toISOString(),
      accountId: "act_123",
    });

    const deps = makeDeps({
      listMetaConnections: vi.fn().mockResolvedValue([
        {
          id: "conn_1",
          deploymentId: "dep_1",
          type: "meta-ads",
          status: "active",
          credentials: creds,
          metadata: null,
        },
      ]),
      refreshTokenIfNeeded: vi.fn().mockRejectedValue(new Error("Token expired")),
    });

    const result = await executeMetaTokenRefresh(makeStep(), deps);

    expect(result.failed).toBe(1);
    expect(deps.updateStatus).toHaveBeenCalledWith("conn_1", "needs_reauth");
  });

  it("skips non-active connections", async () => {
    const creds = encryptTestCreds({
      accessToken: "token",
      tokenExpiresAt: new Date().toISOString(),
    });

    const deps = makeDeps({
      listMetaConnections: vi.fn().mockResolvedValue([
        {
          id: "conn_1",
          deploymentId: "dep_1",
          type: "meta-ads",
          status: "needs_reauth",
          credentials: creds,
          metadata: null,
        },
      ]),
    });

    const result = await executeMetaTokenRefresh(makeStep(), deps);

    expect(result.checked).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
