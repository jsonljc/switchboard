import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// (mercury)/layout.tsx hands children to EditorialAuthShell, which is an
// async server component that calls fetchEnabledAgentsServer at request
// time. Importing the layout module under vitest pulls next-auth's internal
// `next/server` resolution and fails — so this is a source-text guardrail,
// not a render test. The structural contract that matters is "the layout
// wraps children in EditorialAuthShell"; runtime behavior is covered by the
// shell's own tests + the per-Mercury page tests.
describe("(mercury)/layout — shell-mount guardrail", () => {
  const source = readFileSync(join(__dirname, "../layout.tsx"), "utf8");

  it("imports EditorialAuthShell from the layout components barrel", () => {
    expect(source).toMatch(
      /import\s*\{\s*EditorialAuthShell\s*\}\s*from\s*"@\/components\/layout\/editorial-auth-shell"/,
    );
  });

  it("wraps children in EditorialAuthShell", () => {
    expect(source).toMatch(/<EditorialAuthShell>\s*\{children\}\s*<\/EditorialAuthShell>/);
  });

  it("exports a default function", () => {
    expect(source).toMatch(/export\s+default\s+function\s+MercuryLayout/);
  });
});
