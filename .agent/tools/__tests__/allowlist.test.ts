import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  loadAllowlist,
  isAllowlisted,
  validateTemporaryEntries,
  type AllowlistEntry,
} from "../allowlist.js";

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

describe("validateTemporaryEntries", () => {
  it("returns no errors for a permanently-justified entry", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason: "Permanently justified: webhook receiver — no operator action.",
      },
    ];
    expect(validateTemporaryEntries(entries)).toEqual([]);
  });

  it("returns no errors for a temporary entry that cites an issue in its reason", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason:
          "Temporarily justified: governed mutator pending migration. Follow-up: route-governance-cleanup (#562).",
      },
    ];
    expect(validateTemporaryEntries(entries)).toEqual([]);
  });

  it("returns an error when a temporary entry has no #NNN reference in its reason", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason: "Temporarily justified: governed mutator pending migration.",
      },
    ];
    const errors = validateTemporaryEntries(entries);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"apps/api/src/routes/foo.ts"');
    expect(errors[0]).toMatch(/cite an open issue/);
    expect(errors[0]).toMatch(/in its reason field/);
  });

  it("counts multiple offending entries", () => {
    const entries: AllowlistEntry[] = [
      { path: "a.ts", reason: "Temporarily justified: a." },
      { path: "b.ts", reason: "Temporarily justified: b. #999" },
      { path: "c.ts", reason: "Temporarily justified: c." },
    ];
    expect(validateTemporaryEntries(entries)).toHaveLength(2);
  });
});
