import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAdminConsentRoutes } from "../routes/admin-consent.js";
import {
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
  type ConsentService,
  type ContactConsentReader,
} from "@switchboard/core";
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
  consentService?: Partial<ConsentService>;
  consentReader?: Partial<ContactConsentReader>;
  actor?: string;
}

const buildApp = async (
  opts: BuildOpts = {},
): Promise<{
  app: FastifyInstance;
  consentService: ConsentService;
  consentReader: ContactConsentReader;
}> => {
  const consentService: ConsentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
    ...opts.consentService,
  };
  const consentReader: ContactConsentReader = {
    read: vi.fn().mockResolvedValue(emptyState),
    ...opts.consentReader,
  };

  const app = Fastify({ logger: false });
  registerAdminConsentRoutes(app, {
    consentService,
    consentReader,
    resolveActor: async () => opts.actor ?? "operator_42",
  });
  return { app, consentService, consentReader };
};

const grantBody = {
  contactId: "c1",
  jurisdiction: "MY",
  source: "operator_recorded",
  grantedAt: "2026-05-11T10:00:00.000Z",
  notes: "Captured offline at intake",
};

const revokeBody = {
  contactId: "c1",
  source: "operator_recorded_revocation",
  revokedAt: "2026-05-11T11:00:00.000Z",
  notes: "Customer requested by phone",
};

const clearBody = {
  contactId: "c1",
  notes: "Operator reset after revocation cycle complete",
};

describe("POST /api/admin/consent/grant", () => {
  it("returns 200 + post-mutation state", async () => {
    const { app } = await buildApp({
      consentReader: {
        read: vi.fn().mockResolvedValue({
          ...emptyState,
          pdpaJurisdiction: "MY",
          consentGrantedAt: "2026-05-11T10:00:00.000Z",
          consentSource: "operator_recorded",
        }),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: grantBody,
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe("granted");
    expect(json.consentGrantedAt).toBeTruthy();
  });

  it("returns 409 with hint when contact is already revoked", async () => {
    const { app } = await buildApp({
      consentService: {
        recordGrant: vi.fn().mockRejectedValue(
          new ConsentRevokedCannotRegrant({
            contactId: "c1",
            revokedAt: new Date("2026-05-10T00:00:00Z"),
          }),
        ),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: grantBody,
    });
    expect(res.statusCode).toBe(409);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe("consent_revoked_cannot_regrant");
    expect(json.hint).toMatch(/clear/);
  });

  it("returns 400 with stamped+provided when jurisdiction mismatches", async () => {
    const { app } = await buildApp({
      consentService: {
        recordGrant: vi.fn().mockRejectedValue(
          new ConsentJurisdictionMismatch({
            contactId: "c1",
            stamped: "SG",
            provided: "MY",
          }),
        ),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: grantBody,
    });
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe("jurisdiction_mismatch");
    expect(json.stamped).toBe("SG");
    expect(json.provided).toBe("MY");
  });
});

describe("POST /api/admin/consent/revoke", () => {
  it("returns 200 with revoked status", async () => {
    const { app } = await buildApp({
      consentReader: {
        read: vi.fn().mockResolvedValue({
          ...emptyState,
          pdpaJurisdiction: "MY",
          consentRevokedAt: "2026-05-11T11:00:00.000Z",
          consentSource: "operator_recorded_revocation",
        }),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      payload: revokeBody,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe("revoked");
  });
});

describe("POST /api/admin/consent/clear", () => {
  it("returns 400 when notes are empty", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      payload: { ...clearBody, notes: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 + pending status after successful clear", async () => {
    const { app } = await buildApp({
      consentReader: {
        read: vi.fn().mockResolvedValue({
          ...emptyState,
          pdpaJurisdiction: "MY",
        }),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      payload: clearBody,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe("pending");
  });
});

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
