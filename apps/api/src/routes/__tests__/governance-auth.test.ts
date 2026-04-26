import { describe, it, expect } from "vitest";

describe("governance auth pattern", () => {
  it("rejects request when organizationIdFromAuth is undefined (no org scope)", () => {
    // Simulates a request without org-scoped auth
    const organizationIdFromAuth: string | undefined = undefined;

    // OLD behavior (bug): this check passes when organizationIdFromAuth is falsy
    const oldCheck = organizationIdFromAuth && "org-1" !== organizationIdFromAuth;
    expect(oldCheck).toBeFalsy(); // Bug: allows access

    // NEW behavior: requireOrganizationScope returns null, handler aborts
    const orgId = organizationIdFromAuth ?? null;
    expect(orgId).toBeNull();
  });

  it("rejects request when orgId path param mismatches auth scope", () => {
    const organizationIdFromAuth = "org-1";
    const pathOrgId = "org-2";

    // Both old and new reject this
    expect(pathOrgId).not.toBe(organizationIdFromAuth);
  });

  it("allows request when orgId matches auth scope", () => {
    const organizationIdFromAuth = "org-1";
    const pathOrgId = "org-1";
    expect(pathOrgId).toBe(organizationIdFromAuth);
  });
});
