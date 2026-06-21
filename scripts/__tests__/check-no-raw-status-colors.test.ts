import { describe, it, expect } from "vitest";
import {
  auditDashboardStatusColors,
  findRawStatusColorLines,
} from "../check-no-raw-status-colors.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

describe("findRawStatusColorLines", () => {
  it("flags raw bg amber and yellow classes", () => {
    expect(findRawStatusColorLines('className="bg-amber-100 text-amber-800"')).toEqual([1]);
    expect(findRawStatusColorLines('warning: "bg-yellow-500",')).toEqual([1]);
  });

  it("flags raw text amber and yellow classes", () => {
    expect(findRawStatusColorLines('<p className="text-amber-500">')).toEqual([1]);
    expect(findRawStatusColorLines("text-yellow-600")).toEqual([1]);
  });

  it("flags border/ring, opacity, and variant-prefixed forms", () => {
    expect(findRawStatusColorLines("border-amber-200")).toEqual([1]);
    expect(findRawStatusColorLines("hover:bg-yellow-400 text-yellow-300")).toEqual([1]);
    expect(findRawStatusColorLines("bg-yellow-400/20")).toEqual([1]);
  });

  it("does NOT flag the semantic tokens that replace raw amber", () => {
    expect(findRawStatusColorLines("bg-caution-subtle text-foreground ring-caution/25")).toEqual(
      [],
    );
    expect(findRawStatusColorLines("bg-caution text-caution-foreground")).toEqual([]);
    expect(findRawStatusColorLines("text-positive bg-positive-subtle")).toEqual([]);
  });

  it("does NOT flag other raw palettes (green/red/purple are out of this guard's scope)", () => {
    expect(findRawStatusColorLines("bg-green-500 text-red-600 bg-purple-100")).toEqual([]);
  });

  it("does NOT flag the word amber in comments or prose strings", () => {
    expect(findRawStatusColorLines("// raw amber-100 is banned here")).toEqual([]);
    expect(findRawStatusColorLines("/* use amber tones via tokens */\nconst a = 1;")).toEqual([]);
    expect(findRawStatusColorLines("const label = 'Amber alert';")).toEqual([]);
  });

  it("reports each offending line number", () => {
    const src = "const a = 1;\nbg-amber-100;\nconst b = 2;\ntext-yellow-700;";
    expect(findRawStatusColorLines(src)).toEqual([2, 4]);
  });
});

describe("auditDashboardStatusColors (real repo)", () => {
  it("finds no raw amber/yellow status classes in dashboard src", () => {
    expect(auditDashboardStatusColors({ repoRoot: REPO_ROOT })).toEqual([]);
  });
});
