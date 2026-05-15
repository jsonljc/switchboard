// apps/api/src/routes/__tests__/admin-consent-ingress.test.ts
// ---------------------------------------------------------------------------
// PlatformIngress migration tests for Phase 1b.4:
//   POST /api/admin/consent/grant
//   POST /api/admin/consent/revoke
//   POST /api/admin/consent/clear
//
// Mirrors the existing POST describe blocks from
// apps/api/src/__tests__/admin-consent.test.ts but uses buildTestServer
// (which wires PlatformIngress) and asserts that app.lastIngressTrace
// confirms the route went through ingress with mode=operator_mutation.
//
// Each typed ConsentService error must map to a shared
// OPERATOR_INTENT_ERROR_CODES literal AND preserve the existing route's
// structured response envelope (stamped/provided, hint/revokedAt, etc.).
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ContactConsentState } from "@switchboard/schemas";
import {
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
  type ConsentService,
  type ContactConsentReader,
} from "@switchboard/core";
import { buildTestServer } from "../../__tests__/test-server.js";

// ---------------------------------------------------------------------------
// Fixtures + builders
// ---------------------------------------------------------------------------

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

function makeService(overrides: Partial<ConsentService> = {}): ConsentService {
  return {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeReader(overrides: Partial<ContactConsentReader> = {}): ContactConsentReader {
  return {
    read: vi.fn().mockResolvedValue(emptyState),
    ...overrides,
  };
}

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

const grantedState: ContactConsentState = {
  ...emptyState,
  pdpaJurisdiction: "MY",
  consentGrantedAt: "2026-05-11T10:00:00.000Z",
  consentSource: "operator_recorded",
};

const revokedState: ContactConsentState = {
  ...emptyState,
  pdpaJurisdiction: "MY",
  consentRevokedAt: "2026-05-11T11:00:00.000Z",
  consentSource: "operator_recorded_revocation",
};

// ---------------------------------------------------------------------------
// POST /api/admin/consent/grant — Phase 1b.4 ingress tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/consent/grant — PlatformIngress migration (Phase 1b.4)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 happy path — enters PlatformIngress and persists WorkTrace with mode=operator_mutation", async () => {
    const consentService = makeService();
    const consentReader = makeReader({ read: vi.fn().mockResolvedValue(grantedState) });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: grantBody,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { status: string; consentGrantedAt: string };
    expect(json.status).toBe("granted");
    expect(json.consentGrantedAt).toBeTruthy();
    expect(consentService.recordGrant).toHaveBeenCalledOnce();

    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.grant_consent");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org-1");
    expect(last!.outcome).toBe("completed");
  });

  it("404 contact_not_found — handler maps ContactNotFound → CONSENT_NOT_FOUND, WorkTrace outcome=failed", async () => {
    const consentService = makeService({
      recordGrant: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: grantBody,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "contact_not_found", contactId: "c1" });
    expect(app.lastIngressTrace?.outcome).toBe("failed");
  });

  it("400 jurisdiction_mismatch — handler maps ConsentJurisdictionMismatch → CONSENT_INVALID_JURISDICTION, preserves stamped+provided envelope", async () => {
    const consentService = makeService({
      recordGrant: vi
        .fn()
        .mockRejectedValue(
          new ConsentJurisdictionMismatch({ contactId: "c1", stamped: "SG", provided: "MY" }),
        ),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: grantBody,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "jurisdiction_mismatch",
      stamped: "SG",
      provided: "MY",
    });
    expect(app.lastIngressTrace?.outcome).toBe("failed");
  });

  it("409 consent_revoked_cannot_regrant — handler maps ConsentRevokedCannotRegrant → CONSENT_REVOKED_CANNOT_REGRANT, preserves hint+revokedAt envelope", async () => {
    const consentService = makeService({
      recordGrant: vi.fn().mockRejectedValue(
        new ConsentRevokedCannotRegrant({
          contactId: "c1",
          revokedAt: new Date("2026-05-10T00:00:00Z"),
        }),
      ),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: grantBody,
    });

    expect(res.statusCode).toBe(409);
    const json = res.json() as { error: string; hint: string; revokedAt: string };
    expect(json.error).toBe("consent_revoked_cannot_regrant");
    expect(json.hint).toMatch(/clear/);
    expect(json.revokedAt).toBe("2026-05-10T00:00:00.000Z");
    expect(app.lastIngressTrace?.outcome).toBe("failed");
  });

  it("400 invalid_body — Zod parse failure exits BEFORE ingress (no WorkTrace)", async () => {
    const consentService = makeService();
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { contactId: "" }, // missing jurisdiction etc.
    });

    expect(res.statusCode).toBe(400);
    expect(consentService.recordGrant).not.toHaveBeenCalled();
    // No WorkTrace — request exited at Zod validation before entering ingress.
    expect(app.ingressTraceCount ?? 0).toBe(0);
  });

  it("idempotency: same Idempotency-Key + payload returns cached result without re-invoking consentService", async () => {
    const consentService = makeService();
    const consentReader = makeReader({ read: vi.fn().mockResolvedValue(grantedState) });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const headers = {
      "content-type": "application/json",
      "idempotency-key": "test-key-grant-1",
      "x-org-id": "org-1",
      "x-organization-id": "org-1",
      "x-principal-id": "default",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers,
      payload: grantBody,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      headers,
      payload: grantBody,
    });
    expect(second.statusCode).toBe(200);

    // Cached replay must NOT re-invoke recordGrant.
    expect(consentService.recordGrant).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/consent/revoke — Phase 1b.4 ingress tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/consent/revoke — PlatformIngress migration (Phase 1b.4)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 happy path — enters PlatformIngress and persists WorkTrace with intent=operator.revoke_consent", async () => {
    const consentService = makeService();
    const consentReader = makeReader({ read: vi.fn().mockResolvedValue(revokedState) });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: revokeBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "revoked" });
    expect(consentService.recordRevocation).toHaveBeenCalledOnce();

    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.revoke_consent");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org-1");
    expect(last!.outcome).toBe("completed");
  });

  it("404 contact_not_found — handler maps ContactNotFound → CONSENT_NOT_FOUND", async () => {
    const consentService = makeService({
      recordRevocation: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: revokeBody,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "contact_not_found", contactId: "c1" });
    expect(app.lastIngressTrace?.outcome).toBe("failed");
  });

  it("organizationId flows through ingress — service handler receives x-org-id-derived org", async () => {
    const consentService = makeService();
    const consentReader = makeReader({ read: vi.fn().mockResolvedValue(revokedState) });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      headers: { "x-org-id": "org-sg-001", "content-type": "application/json" },
      payload: revokeBody,
    });

    expect(consentService.recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-sg-001" }),
    );
  });

  it("idempotency: same Idempotency-Key + payload returns cached result without re-invoking consentService", async () => {
    const consentService = makeService();
    const consentReader = makeReader({ read: vi.fn().mockResolvedValue(revokedState) });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const headers = {
      "content-type": "application/json",
      "idempotency-key": "test-key-revoke-1",
      "x-org-id": "org-1",
      "x-organization-id": "org-1",
      "x-principal-id": "default",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      headers,
      payload: revokeBody,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      headers,
      payload: revokeBody,
    });
    expect(second.statusCode).toBe(200);

    expect(consentService.recordRevocation).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/consent/clear — Phase 1b.4 ingress tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/consent/clear — PlatformIngress migration (Phase 1b.4)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("200 happy path — enters PlatformIngress and persists WorkTrace with intent=operator.clear_consent", async () => {
    const consentService = makeService();
    const consentReader = makeReader({
      read: vi.fn().mockResolvedValue({ ...emptyState, pdpaJurisdiction: "MY" }),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: clearBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending" });
    expect(consentService.clearConsent).toHaveBeenCalledOnce();

    const last = app.lastIngressTrace;
    expect(last).toBeDefined();
    expect(last!.intent).toBe("operator.clear_consent");
    expect(last!.mode).toBe("operator_mutation");
    expect(last!.organizationId).toBe("org-1");
    expect(last!.outcome).toBe("completed");
  });

  it("404 contact_not_found — handler maps ContactNotFound → CONSENT_NOT_FOUND", async () => {
    const consentService = makeService({
      clearConsent: vi.fn().mockRejectedValue(new ContactNotFound({ contactId: "c1" })),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: clearBody,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "contact_not_found", contactId: "c1" });
    expect(app.lastIngressTrace?.outcome).toBe("failed");
  });

  it("400 invalid_body — empty notes rejected at Zod parse (no WorkTrace)", async () => {
    const consentService = makeService();
    const { app: built } = await buildTestServer({ consentService, consentReader: makeReader() });
    app = built;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      headers: { "x-org-id": "org-1", "content-type": "application/json" },
      payload: { ...clearBody, notes: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(consentService.clearConsent).not.toHaveBeenCalled();
    expect(app.ingressTraceCount ?? 0).toBe(0);
  });

  it("idempotency: same Idempotency-Key + payload returns cached result without re-invoking consentService", async () => {
    const consentService = makeService();
    const consentReader = makeReader({
      read: vi.fn().mockResolvedValue({ ...emptyState, pdpaJurisdiction: "MY" }),
    });
    const { app: built } = await buildTestServer({ consentService, consentReader });
    app = built;

    const headers = {
      "content-type": "application/json",
      "idempotency-key": "test-key-clear-1",
      "x-org-id": "org-1",
      "x-organization-id": "org-1",
      "x-principal-id": "default",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      headers,
      payload: clearBody,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      headers,
      payload: clearBody,
    });
    expect(second.statusCode).toBe(200);

    expect(consentService.clearConsent).toHaveBeenCalledOnce();
  });
});
