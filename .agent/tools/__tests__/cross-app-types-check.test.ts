import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCrossAppTypesAdvisory, enumerateSchemaTypeNames } from "../cross-app-types-check.js";
import { Project } from "ts-morph";

function makeFixtureRepo(files: Record<string, string>): string {
  const root = join(tmpdir(), `cat-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/**
 * Minimal schemas barrel containing the names used by unit tests.
 * Keeps integration tests deterministic without depending on the real
 * packages/schemas/src tree.
 */
const FIXTURE_SCHEMA_FILES: Record<string, string> = {
  "packages/schemas/src/approval.ts": [
    "export interface ApprovalRecord { id: string; }",
    "export type ApprovalState = string;",
  ].join("\n"),
  "packages/schemas/src/handoff.ts": [
    "export interface Handoff { id: string; }",
    "export type HandoffStatus = string;",
  ].join("\n"),
  "packages/schemas/src/index.ts": [
    'export * from "./approval.js";',
    'export * from "./handoff.js";',
  ].join("\n"),
};

describe("runCrossAppTypesAdvisory", () => {
  it("flags exported local interface that duplicates a schemas export name", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].path).toBe("apps/api/src/foo.ts");
    expect(result.warnings[0].message).toContain("ApprovalRecord");
    expect(result.warnings[0].message).toContain("@switchboard/schemas");
    expect(result.warnings[0].message).toContain("import");
  });

  it("flags exported local type alias the same way", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/dashboard/src/lib/x.ts": `export type Handoff = { id: string };`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/dashboard/src/lib/x.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("Handoff");
  });

  it("does NOT flag non-exported (local-only) declarations", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": `interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("does NOT flag a name that doesn't match any schemas export", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": `export interface MinimalApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("honors // route-governance: local-view-model suppression directive", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": [
        "// route-governance: local-view-model",
        "export interface ApprovalRecord { id: string; }",
      ].join("\n"),
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("skips files under __tests__/", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/__tests__/foo.test.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/__tests__/foo.test.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("skips files outside apps/*/src/**", async () => {
    const root = makeFixtureRepo({
      "packages/core/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
      "scripts/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["packages/core/src/foo.ts", "scripts/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("returns exit code 0 even with warnings (advisory-only mode)", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.exitCode).toBe(0);
  });

  it("returns no warnings when no touched files match the scope", async () => {
    const root = makeFixtureRepo({});
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: [],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("flags multiple declarations in one file", async () => {
    const root = makeFixtureRepo({
      ...FIXTURE_SCHEMA_FILES,
      "apps/api/src/foo.ts": [
        "export interface ApprovalRecord { id: string; }",
        "export type Handoff = { id: string };",
      ].join("\n"),
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toHaveLength(2);
    const names = result.warnings.map((w) => w.message);
    expect(names.some((m) => m.includes("ApprovalRecord"))).toBe(true);
    expect(names.some((m) => m.includes("Handoff"))).toBe(true);
  });
});

describe("dynamic schema type enumeration", () => {
  it("collects exported interface + type-alias names from the schemas barrel, ignoring value exports", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "packages/schemas/src/handoff.ts",
      `
      export interface Handoff { id: string; }
      export const HandoffSchema = 1;
      export type HandoffStatus = "open" | "closed";
    `,
    );
    project.createSourceFile("packages/schemas/src/index.ts", `export * from "./handoff.js";`);
    const names = enumerateSchemaTypeNames(project, "packages/schemas/src/index.ts");
    expect(names.has("Handoff")).toBe(true);
    expect(names.has("HandoffStatus")).toBe(true);
    expect(names.has("HandoffSchema")).toBe(false);
  });
});
