import { describe, it, expect } from "vitest";
import {
  auditEnvCompleteness,
  computeAuditResult,
  type Allowlist,
} from "../check-env-completeness.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const EMPTY_ALLOWLIST: Allowlist = {
  required_in_env_example: [],
  ci_only: [],
  test_only: [],
  production_managed: [],
  deprecated_allowed_temporarily: [],
};

describe("auditEnvCompleteness (filesystem)", () => {
  it("reports zero issues on a fully-aligned repo", () => {
    const result = auditEnvCompleteness({ repoRoot: REPO_ROOT });
    expect(result.uncategorized).toEqual([]);
    expect(result.missingFromExample).toEqual([]);
    expect(result.leakedProductionManaged).toEqual([]);
  });

  it("returns an Issue object shape", () => {
    const result = auditEnvCompleteness({ repoRoot: REPO_ROOT });
    expect(result).toMatchObject({
      uncategorized: expect.any(Array),
      missingFromExample: expect.any(Array),
      leakedProductionManaged: expect.any(Array),
      deprecatedWarnings: expect.any(Array),
    });
  });
});

describe("computeAuditResult (pure)", () => {
  it("reports uncategorized keys when an unknown env var appears", () => {
    const result = computeAuditResult({
      codeKeys: ["SOMETHING_UNKNOWN", "DATABASE_URL"],
      exampleKeys: ["DATABASE_URL"],
      allowlist: {
        ...EMPTY_ALLOWLIST,
        required_in_env_example: ["DATABASE_URL"],
      },
    });
    expect(result.uncategorized).toEqual(["SOMETHING_UNKNOWN"]);
    expect(result.missingFromExample).toEqual([]);
    expect(result.leakedProductionManaged).toEqual([]);
  });

  it("reports leakedProductionManaged when a production_managed key appears in .env.example", () => {
    const result = computeAuditResult({
      codeKeys: ["VERCEL_ENV"],
      exampleKeys: ["VERCEL_ENV"],
      allowlist: {
        ...EMPTY_ALLOWLIST,
        production_managed: ["VERCEL_ENV"],
      },
    });
    expect(result.leakedProductionManaged).toEqual(["VERCEL_ENV"]);
    expect(result.uncategorized).toEqual([]);
  });

  it("reports missingFromExample when a required key is absent from .env.example", () => {
    const result = computeAuditResult({
      codeKeys: ["DATABASE_URL"],
      exampleKeys: [],
      allowlist: {
        ...EMPTY_ALLOWLIST,
        required_in_env_example: ["DATABASE_URL"],
      },
    });
    expect(result.missingFromExample).toEqual(["DATABASE_URL"]);
  });

  it("flags deprecated keys still read by code as warnings (no failure)", () => {
    const result = computeAuditResult({
      codeKeys: ["LEGACY_FLAG"],
      exampleKeys: [],
      allowlist: {
        ...EMPTY_ALLOWLIST,
        deprecated_allowed_temporarily: ["LEGACY_FLAG"],
      },
    });
    expect(result.deprecatedWarnings).toEqual(["LEGACY_FLAG"]);
    expect(result.uncategorized).toEqual([]);
  });
});
