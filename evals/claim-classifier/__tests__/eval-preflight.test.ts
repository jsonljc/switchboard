import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isMainPush,
  comparePromptHash,
  appendStepSummary,
  SKIP_MESSAGE,
} from "../eval-preflight.js";

describe("isMainPush", () => {
  it("returns true on push to main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
  });

  it("returns false on pull_request event (any ref)", () => {
    expect(
      isMainPush({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/pull/123/merge",
      }),
    ).toBe(false);
    expect(
      isMainPush({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/heads/main",
      }),
    ).toBe(false);
  });

  it("returns false on push to a non-main branch", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature-x" })).toBe(
      false,
    );
  });

  it("returns false outside CI (env vars absent)", () => {
    expect(isMainPush({})).toBe(false);
  });
});

describe("comparePromptHash", () => {
  it("returns ok=true when hashes match", () => {
    const out = comparePromptHash("abc123", "abc123");
    expect(out.ok).toBe(true);
    expect(out.currentHash).toBe("abc123");
    expect(out.baselineHash).toBe("abc123");
  });

  it("returns ok=false when hashes differ", () => {
    const out = comparePromptHash("abc123", "def456");
    expect(out.ok).toBe(false);
    expect(out.currentHash).toBe("abc123");
    expect(out.baselineHash).toBe("def456");
  });
});

describe("appendStepSummary", () => {
  let dir: string;
  let summaryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eval-preflight-"));
    summaryPath = join(dir, "summary.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes message + newline to $GITHUB_STEP_SUMMARY when defined", () => {
    appendStepSummary("hello world", { GITHUB_STEP_SUMMARY: summaryPath });
    expect(existsSync(summaryPath)).toBe(true);
    expect(readFileSync(summaryPath, "utf8")).toBe("hello world\n");
  });

  it("appends to existing summary file without truncating", () => {
    appendStepSummary("first line", { GITHUB_STEP_SUMMARY: summaryPath });
    appendStepSummary("second line", { GITHUB_STEP_SUMMARY: summaryPath });
    expect(readFileSync(summaryPath, "utf8")).toBe("first line\nsecond line\n");
  });

  it("is a no-op when $GITHUB_STEP_SUMMARY is absent", () => {
    expect(() => appendStepSummary("ignored", {})).not.toThrow();
    expect(existsSync(summaryPath)).toBe(false);
  });
});

describe("SKIP_MESSAGE constant", () => {
  // Pins the SKIPPED wording so a refactor that accidentally changes it to "PASS"
  // (or anything the operator might confuse with success) fails the test suite.
  // The spec §Acceptance criteria requires that a skipped run "uses SKIPPED wording, not PASS wording."
  it("contains 'skipped' (case-insensitive)", () => {
    expect(SKIP_MESSAGE).toMatch(/skipped/i);
  });

  it("does NOT contain 'pass' or 'success' (case-insensitive)", () => {
    expect(SKIP_MESSAGE).not.toMatch(/pass/i);
    expect(SKIP_MESSAGE).not.toMatch(/success/i);
  });

  it("references the missing env var by name so the cause is obvious in the log", () => {
    expect(SKIP_MESSAGE).toContain("ANTHROPIC_API_KEY");
  });
});
