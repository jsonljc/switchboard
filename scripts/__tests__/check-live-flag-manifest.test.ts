import { describe, it, expect } from "vitest";
import {
  auditLiveFlagManifest,
  compareLiveFlagDefaults,
  type Matrix,
} from "../check-live-flag-manifest.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

describe("auditLiveFlagManifest", () => {
  it("reports zero drift when .env.example matches the matrix", () => {
    const result = auditLiveFlagManifest({ repoRoot: REPO_ROOT });
    expect(result.drift).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

describe("compareLiveFlagDefaults", () => {
  it("detects drift when actual value differs from matrix default", () => {
    const matrix: Matrix = {
      flags: {
        FLAG_X: { default: "true", rationale: "synthetic" },
      },
    };
    const actual = new Map<string, string>([["FLAG_X", "false"]]);

    const result = compareLiveFlagDefaults({ matrix, actual });

    expect(result.drift).toEqual([{ name: "FLAG_X", expected: "true", actual: "false" }]);
    expect(result.missing).toEqual([]);
  });

  it("detects missing flags when actual map omits a matrix entry", () => {
    const matrix: Matrix = {
      flags: {
        FLAG_Y: { default: "true", rationale: "synthetic" },
      },
    };
    const actual = new Map<string, string>();

    const result = compareLiveFlagDefaults({ matrix, actual });

    expect(result.missing).toEqual(["FLAG_Y"]);
    expect(result.drift).toEqual([]);
  });

  it("reports both drift and missing when matrix has multiple flags", () => {
    const matrix: Matrix = {
      flags: {
        FLAG_A: { default: "true", rationale: "synthetic" },
        FLAG_B: { default: "false", rationale: "synthetic" },
      },
    };
    const actual = new Map<string, string>([["FLAG_A", "false"]]);

    const result = compareLiveFlagDefaults({ matrix, actual });

    expect(result.drift).toEqual([{ name: "FLAG_A", expected: "true", actual: "false" }]);
    expect(result.missing).toEqual(["FLAG_B"]);
  });
});
