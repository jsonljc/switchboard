import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadAllowlist, isAllowlisted } from "../allowlist.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("allowlist", () => {
  it("loads valid entries with paths and reasons", () => {
    const entries = loadAllowlist(fixture("allowlist-valid.yaml"));
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("apps/api/src/routes/auth/*.ts");
    expect(entries[0].reason).toMatch(/Auth/);
  });

  it("throws when an entry is missing a reason", () => {
    expect(() => loadAllowlist(fixture("allowlist-missing-reason.yaml"))).toThrow(
      /reason.*required/i,
    );
  });

  it("throws when reason is empty or whitespace", () => {
    expect(() => loadAllowlist(fixture("allowlist-empty-reason.yaml"))).toThrow(
      /reason.*required/i,
    );
  });

  it("matches glob entries against finding paths", () => {
    const entries = loadAllowlist(fixture("allowlist-valid.yaml"));
    expect(isAllowlisted("apps/api/src/routes/auth/login.ts", entries)).toBe(true);
    expect(isAllowlisted("apps/api/src/routes/billing.ts", entries)).toBe(false);
    expect(isAllowlisted("packages/core/foo.test.ts", entries)).toBe(true);
  });
});
