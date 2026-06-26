// apps/api/src/__tests__/admin-consent.test.ts
// ---------------------------------------------------------------------------
// Tests for the admin-consent route's read-side endpoint:
//   GET /api/admin/consent/:contactId
//
// POST routes (grant/revoke/clear) were migrated to PlatformIngress in
// Phase 1b.4. Their ingress-style tests live in:
//   apps/api/src/routes/__tests__/admin-consent-ingress.test.ts
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAdminConsentRoutes } from "../routes/admin-consent.js";
import { ContactNotFound, type ContactConsentReader } from "@switchboard/core";
import type { ContactConsentState } from "@switchboard/schemas";

const emptyState: ContactConsentState = {
  pdpaJurisdiction: null,
  consentGrantedAt: null,
  consentRevokedAt: null,
  consentSource: null,
  aiDisclosureVersionShown: null,
  aiDisclosureShownAt: null,
  consentUpdatedBy: null,
  consentNotes: null,
};

interface BuildOpts {
  consentReader?: Partial<ContactConsentReader>;
}

const buildApp = async (
  opts: BuildOpts = {},
): Promise<{
  app: FastifyInstance;
  consentReader: ContactConsentReader;
}> => {
  const consentReader: ContactConsentReader = {
    read: vi.fn().mockResolvedValue(emptyState),
    ...opts.consentReader,
  };

  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  registerAdminConsentRoutes(app, {
    consentReader,
  });
  return { app, consentReader };
};

describe("GET /api/admin/consent/:contactId", () => {
  it("returns 404 when contact missing", async () => {
    const { app } = await buildApp({
      consentReader: {
        read: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "missing" })),
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/consent/missing",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns state + derived status", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/consent/c1",
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("pdpaJurisdiction");
  });

  it("does not leak the contact's phoneE164 into the response", async () => {
    // The reader carries phoneE164 (for per-lead jurisdiction resolution at the
    // consent gate), but it must NOT surface on the admin consent response.
    const { app } = await buildApp({
      consentReader: {
        read: vi.fn().mockResolvedValue({ ...emptyState, phoneE164: "+60123456789" }),
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/consent/c1",
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json).not.toHaveProperty("phoneE164");
  });

  it("scopes the read to the authenticated org (no cross-tenant consent read)", async () => {
    // Regression pin for the org-scoping fix: the route MUST pass the caller's
    // org to the reader, so an operator cannot read another tenant's consent
    // record by contactId. The pre-fix route called read(contactId) with no org.
    const { app, consentReader } = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/consent/c1",
      headers: { "x-org-id": "org_test" },
    });
    expect(res.statusCode).toBe(200);
    expect(consentReader.read).toHaveBeenCalledWith("org_test", "c1");
  });
});
