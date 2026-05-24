import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..");

describe("marketing relocation", () => {
  it("marketing landing now lives under (public)/welcome", () => {
    expect(existsSync(join(APP, "(public)/welcome/page.tsx"))).toBe(true);
  });
  it("(public) no longer owns the root path", () => {
    expect(existsSync(join(APP, "(public)/page.tsx"))).toBe(false);
  });
});
