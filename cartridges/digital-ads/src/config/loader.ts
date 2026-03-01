import { readFileSync } from "node:fs";
import type { AccountConfig, RawAccountConfig, PlatformAccountConfig } from "./types.js";
import type { PlatformCredentials, PlatformType } from "../platforms/types.js";

// ---------------------------------------------------------------------------
// Config Loader
// ---------------------------------------------------------------------------
// Loads multi-platform account configuration from a JSON file or builds
// it at runtime. Credentials can reference environment variables using
// the "$ENV_VAR_NAME" syntax.
// ---------------------------------------------------------------------------

/**
 * Load an AccountConfig from a JSON file.
 * Environment variable references in credentials (values starting with "$")
 * are resolved from process.env.
 */
export function loadConfig(filePath: string): AccountConfig {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as RawAccountConfig;
  return resolveConfig(raw);
}

/**
 * Build an AccountConfig at runtime from a partial config object.
 * Applies defaults for optional fields.
 */
export function buildConfig(
  partial: Partial<AccountConfig> & Pick<AccountConfig, "name" | "vertical" | "platforms">
): AccountConfig {
  return {
    name: partial.name,
    vertical: partial.vertical,
    platforms: partial.platforms,
    periodDays: partial.periodDays ?? 7,
    referenceDate: partial.referenceDate,
  };
}

// ---------------------------------------------------------------------------
// Internal: resolve raw config to typed config
// ---------------------------------------------------------------------------

function resolveConfig(raw: RawAccountConfig): AccountConfig {
  const platforms: PlatformAccountConfig[] = raw.platforms.map((p) => ({
    platform: p.platform,
    enabled: p.enabled,
    entityId: p.entityId,
    entityLevel: p.entityLevel,
    qualifiedLeadActionType: p.qualifiedLeadActionType,
    enableStructuralAnalysis: p.enableStructuralAnalysis,
    enableHistoricalTrends: p.enableHistoricalTrends,
    historicalPeriods: p.historicalPeriods,
    credentials: resolveCredentials(p.platform, p.credentials),
  }));

  return {
    name: raw.name,
    vertical: raw.vertical,
    platforms,
    periodDays: raw.periodDays ?? 7,
    referenceDate: raw.referenceDate,
  };
}

function resolveCredentials(
  platform: PlatformType,
  raw: Record<string, string>
): PlatformCredentials {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const envVar = value.slice(1);
      const envValue = process.env[envVar];
      if (!envValue) {
        throw new Error(
          `Environment variable "${envVar}" is not set (required for ${platform} credential "${key}")`
        );
      }
      resolved[key] = envValue;
    } else {
      resolved[key] = value;
    }
  }

  switch (platform) {
    case "meta":
      return {
        platform: "meta",
        accessToken: requireField(resolved, "accessToken", platform),
      };
    case "google":
      return {
        platform: "google",
        clientId: requireField(resolved, "clientId", platform),
        clientSecret: requireField(resolved, "clientSecret", platform),
        refreshToken: requireField(resolved, "refreshToken", platform),
        developerToken: requireField(resolved, "developerToken", platform),
        loginCustomerId: resolved.loginCustomerId,
      };
    case "tiktok":
      return {
        platform: "tiktok",
        accessToken: requireField(resolved, "accessToken", platform),
        appId: requireField(resolved, "appId", platform),
      };
  }
}

function requireField(
  obj: Record<string, string>,
  field: string,
  platform: string
): string {
  const value = obj[field];
  if (!value) {
    throw new Error(
      `Missing required credential "${field}" for platform "${platform}"`
    );
  }
  return value;
}
