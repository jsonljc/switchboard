import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig, buildConfig } from "../loader.js";
import type { AccountConfig, RawAccountConfig } from "../types.js";

// ── Mock node:fs globally ──
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
const mockedReadFileSync = vi.mocked(readFileSync);

// ── Test Data ──

const makeRawConfig = (overrides?: Partial<RawAccountConfig>): RawAccountConfig => ({
  name: "Test Account",
  vertical: "commerce",
  platforms: [
    {
      platform: "meta",
      enabled: true,
      entityId: "act_123456",
      entityLevel: "account",
      qualifiedLeadActionType: "lead",
      enableStructuralAnalysis: true,
      enableHistoricalTrends: false,
      historicalPeriods: 4,
      credentials: {
        accessToken: "test-token",
      },
    },
  ],
  periodDays: 7,
  ...overrides,
});

const makePartialConfig = (
  overrides?: Partial<AccountConfig>,
): Partial<AccountConfig> & Pick<AccountConfig, "name" | "vertical" | "platforms"> => ({
  name: "Test Account",
  vertical: "commerce",
  platforms: [
    {
      platform: "meta",
      enabled: true,
      entityId: "act_123456",
      entityLevel: "account",
      credentials: {
        platform: "meta",
        accessToken: "test-token",
      },
    },
  ],
  ...overrides,
});

// ── loadConfig Tests ──

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TEST_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
  });

  it("parses JSON and returns AccountConfig", () => {
    const raw = makeRawConfig();
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.name).toBe("Test Account");
    expect(result.vertical).toBe("commerce");
    expect(result.platforms).toHaveLength(1);
    expect(result.platforms[0].platform).toBe("meta");
    expect(result.platforms[0].credentials).toEqual({
      platform: "meta",
      accessToken: "test-token",
    });
    expect(mockedReadFileSync).toHaveBeenCalledWith("/path/to/config.json", "utf-8");
  });

  it("resolves $ENV_VAR references in credentials from process.env", () => {
    process.env.META_ACCESS_TOKEN = "env-secret-token";

    const raw = makeRawConfig({
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123456",
          credentials: {
            accessToken: "$META_ACCESS_TOKEN",
          },
        },
      ],
    });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.platforms[0].credentials).toEqual({
      platform: "meta",
      accessToken: "env-secret-token",
    });
  });

  it("resolves multiple env var references across platforms", () => {
    process.env.META_TOKEN = "meta-secret";
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    process.env.GOOGLE_REFRESH_TOKEN = "google-refresh";
    process.env.GOOGLE_DEV_TOKEN = "google-dev";

    const raw: RawAccountConfig = {
      name: "Multi-Platform Account",
      vertical: "clinic",
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123",
          credentials: {
            accessToken: "$META_TOKEN",
          },
        },
        {
          platform: "google",
          enabled: true,
          entityId: "456",
          credentials: {
            clientId: "$GOOGLE_CLIENT_ID",
            clientSecret: "$GOOGLE_CLIENT_SECRET",
            refreshToken: "$GOOGLE_REFRESH_TOKEN",
            developerToken: "$GOOGLE_DEV_TOKEN",
          },
        },
      ],
    };
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.platforms[0].credentials).toEqual({
      platform: "meta",
      accessToken: "meta-secret",
    });
    expect(result.platforms[1].credentials).toEqual({
      platform: "google",
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      refreshToken: "google-refresh",
      developerToken: "google-dev",
      loginCustomerId: undefined,
    });
  });

  it("preserves literal credential values that don't start with $", () => {
    const raw = makeRawConfig({
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123456",
          credentials: {
            accessToken: "literal-token-value",
          },
        },
      ],
    });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.platforms[0].credentials).toEqual({
      platform: "meta",
      accessToken: "literal-token-value",
    });
  });

  it("throws when environment variable is not set", () => {
    const raw = makeRawConfig({
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123456",
          credentials: {
            accessToken: "$MISSING_TOKEN",
          },
        },
      ],
    });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      'Environment variable "MISSING_TOKEN" is not set (required for meta credential "accessToken")',
    );
  });

  it("throws on invalid JSON", () => {
    mockedReadFileSync.mockReturnValueOnce("not valid json{{{");

    expect(() => loadConfig("/path/to/config.json")).toThrow();
  });

  it("throws when required credential field is missing for meta platform", () => {
    const raw = makeRawConfig({
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123456",
          credentials: {},
        },
      ],
    });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      'Missing required credential "accessToken" for platform "meta"',
    );
  });

  it("throws when required credential field is missing for google platform", () => {
    const raw: RawAccountConfig = {
      name: "Test",
      vertical: "commerce",
      platforms: [
        {
          platform: "google",
          enabled: true,
          entityId: "123",
          credentials: {
            clientId: "id",
            // missing clientSecret, refreshToken, developerToken
          },
        },
      ],
    };
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      'Missing required credential "clientSecret" for platform "google"',
    );
  });

  it("throws when required credential field is missing for tiktok platform", () => {
    const raw: RawAccountConfig = {
      name: "Test",
      vertical: "commerce",
      platforms: [
        {
          platform: "tiktok",
          enabled: true,
          entityId: "123",
          credentials: {
            accessToken: "token",
            // missing appId
          },
        },
      ],
    };
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    expect(() => loadConfig("/path/to/config.json")).toThrow(
      'Missing required credential "appId" for platform "tiktok"',
    );
  });

  it("applies default periodDays if not specified", () => {
    const raw = makeRawConfig({ periodDays: undefined });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.periodDays).toBe(7);
  });

  it("preserves referenceDate when specified", () => {
    const raw = makeRawConfig({ referenceDate: "2024-12-31" });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.referenceDate).toBe("2024-12-31");
  });

  it("handles Google loginCustomerId optional field", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    process.env.GOOGLE_DEV_TOKEN = "dev";

    const raw: RawAccountConfig = {
      name: "Test",
      vertical: "commerce",
      platforms: [
        {
          platform: "google",
          enabled: true,
          entityId: "123",
          credentials: {
            clientId: "$GOOGLE_CLIENT_ID",
            clientSecret: "$GOOGLE_CLIENT_SECRET",
            refreshToken: "$GOOGLE_REFRESH_TOKEN",
            developerToken: "$GOOGLE_DEV_TOKEN",
            loginCustomerId: "mcc-123",
          },
        },
      ],
    };
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.platforms[0].credentials).toMatchObject({
      platform: "google",
      loginCustomerId: "mcc-123",
    });
  });

  it("resolves all platform config fields correctly", () => {
    const raw = makeRawConfig({
      platforms: [
        {
          platform: "meta",
          enabled: false,
          entityId: "act_999",
          entityLevel: "campaign",
          qualifiedLeadActionType: "purchase",
          enableStructuralAnalysis: false,
          enableHistoricalTrends: true,
          historicalPeriods: 8,
          credentials: {
            accessToken: "token",
          },
        },
      ],
    });
    mockedReadFileSync.mockReturnValueOnce(JSON.stringify(raw));

    const result = loadConfig("/path/to/config.json");

    expect(result.platforms[0]).toMatchObject({
      platform: "meta",
      enabled: false,
      entityId: "act_999",
      entityLevel: "campaign",
      qualifiedLeadActionType: "purchase",
      enableStructuralAnalysis: false,
      enableHistoricalTrends: true,
      historicalPeriods: 8,
    });
  });
});

// ── buildConfig Tests ──

describe("buildConfig", () => {
  it("applies default periodDays when not specified", () => {
    const partial = makePartialConfig();

    const result = buildConfig(partial);

    expect(result.periodDays).toBe(7);
  });

  it("preserves provided periodDays", () => {
    const partial = makePartialConfig({ periodDays: 14 });

    const result = buildConfig(partial);

    expect(result.periodDays).toBe(14);
  });

  it("preserves required fields", () => {
    const partial = makePartialConfig({
      name: "Custom Name",
      vertical: "clinic",
    });

    const result = buildConfig(partial);

    expect(result.name).toBe("Custom Name");
    expect(result.vertical).toBe("clinic");
    expect(result.platforms).toHaveLength(1);
  });

  it("preserves referenceDate when provided", () => {
    const partial = makePartialConfig({ referenceDate: "2024-06-15" });

    const result = buildConfig(partial);

    expect(result.referenceDate).toBe("2024-06-15");
  });

  it("leaves referenceDate undefined when not provided", () => {
    const partial = makePartialConfig();

    const result = buildConfig(partial);

    expect(result.referenceDate).toBeUndefined();
  });

  it("builds config with multiple platforms", () => {
    const partial = makePartialConfig({
      platforms: [
        {
          platform: "meta",
          enabled: true,
          entityId: "act_123",
          credentials: {
            platform: "meta",
            accessToken: "meta-token",
          },
        },
        {
          platform: "google",
          enabled: true,
          entityId: "456",
          credentials: {
            platform: "google",
            clientId: "id",
            clientSecret: "secret",
            refreshToken: "refresh",
            developerToken: "dev",
          },
        },
        {
          platform: "tiktok",
          enabled: true,
          entityId: "789",
          credentials: {
            platform: "tiktok",
            accessToken: "tiktok-token",
            appId: "app-123",
          },
        },
      ],
    });

    const result = buildConfig(partial);

    expect(result.platforms).toHaveLength(3);
    expect(result.platforms[0].platform).toBe("meta");
    expect(result.platforms[1].platform).toBe("google");
    expect(result.platforms[2].platform).toBe("tiktok");
  });

  it("preserves all optional platform config fields", () => {
    const partial: Partial<AccountConfig> & Pick<AccountConfig, "name" | "vertical" | "platforms"> =
      {
        name: "Test",
        vertical: "commerce",
        platforms: [
          {
            platform: "meta",
            enabled: false,
            entityId: "act_999",
            entityLevel: "campaign",
            qualifiedLeadActionType: "purchase",
            enableStructuralAnalysis: true,
            enableHistoricalTrends: true,
            historicalPeriods: 12,
            targetROAS: 3.5,
            credentials: {
              platform: "meta",
              accessToken: "token",
            },
          },
        ],
      };

    const result = buildConfig(partial);

    expect(result.platforms[0]).toMatchObject({
      platform: "meta",
      enabled: false,
      entityId: "act_999",
      entityLevel: "campaign",
      qualifiedLeadActionType: "purchase",
      enableStructuralAnalysis: true,
      enableHistoricalTrends: true,
      historicalPeriods: 12,
      targetROAS: 3.5,
    });
  });
});
