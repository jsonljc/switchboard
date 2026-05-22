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
});
