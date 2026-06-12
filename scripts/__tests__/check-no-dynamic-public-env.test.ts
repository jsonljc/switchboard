import { describe, it, expect } from "vitest";
import { auditDashboardEnvReads, findDynamicEnvReadLines } from "../check-no-dynamic-public-env.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

describe("findDynamicEnvReadLines", () => {
  it("flags a computed bracket read", () => {
    expect(findDynamicEnvReadLines("return process.env[KEY];")).toEqual([1]);
  });

  it("flags a nested computed bracket read", () => {
    expect(findDynamicEnvReadLines("  return process.env[MAP[id]] === 'true';")).toEqual([1]);
  });

  it("flags a string-literal bracket read (also not reliably inlined)", () => {
    expect(findDynamicEnvReadLines('process.env["NEXT_PUBLIC_X"]')).toEqual([1]);
  });

  it("flags optional-chained computed reads", () => {
    expect(findDynamicEnvReadLines("process?.env?.[k]")).toEqual([1]);
    expect(findDynamicEnvReadLines("process.env?.[k]")).toEqual([1]);
    expect(findDynamicEnvReadLines("process?.env[k]")).toEqual([1]);
  });

  it("does NOT flag static dot access", () => {
    expect(findDynamicEnvReadLines("process.env.NEXT_PUBLIC_X === 'true'")).toEqual([]);
  });

  it("does NOT flag optional-chained static access", () => {
    expect(findDynamicEnvReadLines("process?.env?.NEXT_PUBLIC_X")).toEqual([]);
  });

  it("does NOT flag an identifier that merely ends in 'process'", () => {
    expect(findDynamicEnvReadLines("subprocess.env[k]")).toEqual([]);
  });

  it("does NOT flag a line comment mentioning the pattern", () => {
    expect(findDynamicEnvReadLines("// never use process.env[x] here")).toEqual([]);
  });

  it("does NOT flag a block comment mentioning the pattern", () => {
    expect(findDynamicEnvReadLines("/* process.env[x] is banned */\nconst a = 1;")).toEqual([]);
  });

  it("reports each offending line number", () => {
    const src = "const a = 1;\nprocess.env[a];\nconst b = 2;\nprocess.env[b];";
    expect(findDynamicEnvReadLines(src)).toEqual([2, 4]);
  });
});

describe("auditDashboardEnvReads (real repo)", () => {
  it("finds no dynamic process.env[...] reads in dashboard src", () => {
    expect(auditDashboardEnvReads({ repoRoot: REPO_ROOT })).toEqual([]);
  });
});
