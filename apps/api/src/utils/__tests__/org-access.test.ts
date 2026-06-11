import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { resolveCallerOrgId } from "../org-access.js";

function makeRequest(authDisabled: boolean, organizationIdFromAuth?: string): FastifyRequest {
  return {
    server: { authDisabled },
    organizationIdFromAuth,
  } as unknown as FastifyRequest;
}

describe("resolveCallerOrgId", () => {
  it("scopes to the authenticated caller's org when auth is enabled", () => {
    const request = makeRequest(false, "org_caller");
    expect(resolveCallerOrgId(request, "org_resource")).toBe("org_caller");
  });

  it("scopes to the resource's own org in dev mode (auth disabled, no caller identity)", () => {
    // Even if a dev request carries a mismatched org binding, dev mode must not turn an org-scoped
    // read into a spurious miss; scope to the resource's org so the read still resolves.
    const request = makeRequest(true, "org_mismatched");
    expect(resolveCallerOrgId(request, "org_resource")).toBe("org_resource");
  });

  it("falls back to the resource's org when auth is enabled but the request has no org binding", () => {
    const request = makeRequest(false, undefined);
    expect(resolveCallerOrgId(request, "org_resource")).toBe("org_resource");
  });
});
