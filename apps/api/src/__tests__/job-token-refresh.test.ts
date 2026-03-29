import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDecryptCredentials = vi.fn();
const mockRefreshMetaOAuthToken = vi.fn();

vi.mock("@switchboard/db", () => ({
  decryptCredentials: (...args: unknown[]) => mockDecryptCredentials(...args),
  refreshMetaOAuthToken: (...args: unknown[]) => mockRefreshMetaOAuthToken(...args),
}));

import { startTokenRefreshJob } from "../jobs/token-refresh.js";

describe("Token Refresh Job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when no oauth2 connections exist", async () => {
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(prisma.connection.findMany).toHaveBeenCalled();
    expect(mockRefreshMetaOAuthToken).not.toHaveBeenCalled();

    cleanup();
  });

  it("skips connections not near expiry", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conn_1",
            serviceId: "meta-ads",
            serviceName: "Meta Ads",
            organizationId: "org_1",
            authType: "oauth2",
            credentials: "encrypted",
            scopes: [],
            refreshStrategy: "auto",
            status: "connected",
            lastHealthCheck: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockDecryptCredentials.mockReturnValue({
      accessToken: "token",
      tokenExpiresAt: futureDate,
    });

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshMetaOAuthToken).not.toHaveBeenCalled();

    cleanup();
  });

  it("refreshes token when near expiry", async () => {
    const nearExpiryDate = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conn_2",
            serviceId: "meta-ads",
            serviceName: "Meta Ads",
            organizationId: "org_1",
            authType: "oauth2",
            credentials: "encrypted",
            scopes: [],
            refreshStrategy: "auto",
            status: "connected",
            lastHealthCheck: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockDecryptCredentials.mockReturnValue({
      accessToken: "token",
      tokenExpiresAt: nearExpiryDate,
    });
    mockRefreshMetaOAuthToken.mockResolvedValue({
      success: true,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshMetaOAuthToken).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "conn_2" }),
      "Token refreshed successfully",
    );

    cleanup();
  });

  it("marks connection as token_expired on refresh failure", async () => {
    const nearExpiryDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conn_3",
            serviceId: "meta-ads",
            serviceName: "Meta Ads",
            organizationId: "org_1",
            authType: "oauth2",
            credentials: "encrypted",
            scopes: [],
            refreshStrategy: "auto",
            status: "connected",
            lastHealthCheck: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockDecryptCredentials.mockReturnValue({
      accessToken: "token",
      tokenExpiresAt: nearExpiryDate,
    });
    mockRefreshMetaOAuthToken.mockResolvedValue({
      success: false,
      error: "Invalid refresh token",
    });

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(prisma.connection.update).toHaveBeenCalledWith({
      where: { id: "conn_3" },
      data: { status: "token_expired" },
    });

    cleanup();
  });

  it("skips connection on decryption failure", async () => {
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conn_4",
            serviceId: "meta-ads",
            serviceName: "Meta Ads",
            organizationId: "org_1",
            authType: "oauth2",
            credentials: "bad_encrypted_data",
            scopes: [],
            refreshStrategy: "auto",
            status: "connected",
            lastHealthCheck: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    mockDecryptCredentials.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshMetaOAuthToken).not.toHaveBeenCalled();

    cleanup();
  });

  it("cleanup stops the interval", async () => {
    const prisma = {
      connection: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const cleanup = startTokenRefreshJob({
      prisma: prisma as unknown as never,
      logger,
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(prisma.connection.findMany).toHaveBeenCalledTimes(1);

    cleanup();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(prisma.connection.findMany).toHaveBeenCalledTimes(1);
  });
});
