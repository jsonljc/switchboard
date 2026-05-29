import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_ROOT = join(__dirname, "..");

describe("agent route layout (post-split)", () => {
  it("/alex page directory exists", () => {
    expect(existsSync(join(AUTH_ROOT, "alex", "page.tsx"))).toBe(true);
  });

  it("/riley page directory exists", () => {
    expect(existsSync(join(AUTH_ROOT, "riley", "page.tsx"))).toBe(true);
  });

  it("/mira page directory exists (Mira enabled in M1)", () => {
    expect(existsSync(join(AUTH_ROOT, "mira", "page.tsx"))).toBe(true);
  });

  it("[agentKey] dynamic segment removed", () => {
    expect(existsSync(join(AUTH_ROOT, "[agentKey]"))).toBe(false);
  });
});
