import { describe, it, expect } from "vitest";
import {
  PdpaJurisdictionSchema,
  ConsentSourceSchema,
  ContactConsentStateSchema,
  AI_DISCLOSURE_VERSIONS,
  deriveConsentStatus,
  evaluateConsentGate,
  type ContactConsentState,
} from "../pdpa-consent.js";

describe("PdpaJurisdictionSchema", () => {
  it.each(["SG", "MY"])("accepts %s", (j) => {
    expect(PdpaJurisdictionSchema.parse(j)).toBe(j);
  });
  it("rejects unknown jurisdictions", () => {
    expect(() => PdpaJurisdictionSchema.parse("US")).toThrow();
  });
});

describe("ConsentSourceSchema", () => {
  it.each([
    "whatsapp_quick_reply",
    "ig_dm_reply",
    "web_form",
    "operator_recorded",
    "inbound_keyword_revocation",
    "operator_recorded_revocation",
  ])("accepts %s", (s) => {
    expect(ConsentSourceSchema.parse(s)).toBe(s);
  });
});

describe("ContactConsentStateSchema", () => {
  it("round-trips null-everywhere state", () => {
    const empty: ContactConsentState = {
      pdpaJurisdiction: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      consentSource: null,
      aiDisclosureVersionShown: null,
      aiDisclosureShownAt: null,
      consentUpdatedBy: null,
      consentNotes: null,
    };
    expect(ContactConsentStateSchema.parse(empty)).toEqual(empty);
  });

  it("round-trips fully-populated state", () => {
    const full: ContactConsentState = {
      pdpaJurisdiction: "MY",
      consentGrantedAt: "2026-05-11T10:00:00.000Z",
      consentRevokedAt: null,
      consentSource: "whatsapp_quick_reply",
      aiDisclosureVersionShown: "my-disclosure@1.0.0",
      aiDisclosureShownAt: "2026-05-11T09:59:00.000Z",
      consentUpdatedBy: "system:skill_runtime",
      consentNotes: null,
    };
    expect(ContactConsentStateSchema.parse(full)).toEqual(full);
  });
});

describe("AI_DISCLOSURE_VERSIONS", () => {
  it("exports SG and MY constants", () => {
    expect(AI_DISCLOSURE_VERSIONS.SG).toBe("sg-disclosure@1.0.0");
    expect(AI_DISCLOSURE_VERSIONS.MY).toBe("my-disclosure@1.0.0");
  });
});

describe("deriveConsentStatus", () => {
  it("null jurisdiction → not_applicable", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: null,
        consentGrantedAt: null,
        consentRevokedAt: null,
      }),
    ).toBe("not_applicable");
  });

  it("jurisdiction set, no grant, no revoke → pending", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "SG",
        consentGrantedAt: null,
        consentRevokedAt: null,
      }),
    ).toBe("pending");
  });

  it("grant set, no revoke → granted", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: null,
      }),
    ).toBe("granted");
  });

  it("revoke set → revoked (even with grant present)", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: "2026-05-10T00:00:00.000Z",
      }),
    ).toBe("revoked");
  });

  it("revoke wins even when revoke timestamp predates grant (defensive)", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: "2026-05-10T00:00:00.000Z",
        consentRevokedAt: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe("revoked");
  });

  it("revoked but UNSTAMPED jurisdiction → revoked, NOT not_applicable", () => {
    // A first inbound "STOP" revokes via ConsentService.recordRevocation, which sets
    // consentRevokedAt WITHOUT stamping pdpaJurisdiction. Revocation must win over the
    // null-jurisdiction short-circuit, else a revoked contact masks as not_applicable
    // and consumers (e.g. the F15 booking precondition) read it as ALLOW.
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: null,
        consentGrantedAt: null,
        consentRevokedAt: "2026-05-10T00:00:00.000Z",
      }),
    ).toBe("revoked");
  });
});

describe("evaluateConsentGate", () => {
  const base = { pdpaJurisdiction: null, consentGrantedAt: null, consentRevokedAt: null };

  it("operational + not_applicable → allow", () => {
    expect(evaluateConsentGate({ contact: base, messageClass: "operational" })).toEqual({
      action: "allow",
      status: "not_applicable",
    });
  });

  it("operational + pending → allow", () => {
    expect(
      evaluateConsentGate({
        contact: { pdpaJurisdiction: "SG", consentGrantedAt: null, consentRevokedAt: null },
        messageClass: "operational",
      }),
    ).toEqual({ action: "allow", status: "pending" });
  });

  it("operational + granted → allow", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: null,
        },
        messageClass: "operational",
      }),
    ).toEqual({ action: "allow", status: "granted" });
  });

  it("operational + revoked → block (consent_revoked)", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: "2026-05-10T00:00:00.000Z",
        },
        messageClass: "operational",
      }),
    ).toEqual({ action: "block", status: "revoked", reasonCode: "consent_revoked" });
  });

  it("proactive + not_applicable → allow", () => {
    expect(evaluateConsentGate({ contact: base, messageClass: "proactive" })).toEqual({
      action: "allow",
      status: "not_applicable",
    });
  });

  it("proactive + pending → block (consent_pending)", () => {
    expect(
      evaluateConsentGate({
        contact: { pdpaJurisdiction: "SG", consentGrantedAt: null, consentRevokedAt: null },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "block", status: "pending", reasonCode: "consent_pending" });
  });

  it("proactive + granted → allow", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: null,
        },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "allow", status: "granted" });
  });

  it("proactive + revoked → block (consent_revoked)", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: null,
          consentRevokedAt: "2026-05-10T00:00:00.000Z",
        },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "block", status: "revoked", reasonCode: "consent_revoked" });
  });

  // Revoked-but-unstamped (null jurisdiction + revoke set): revocation wins, so BOTH
  // classes must block. Previously this masked as not_applicable → allow on both paths.
  const revokedUnstamped = {
    pdpaJurisdiction: null,
    consentGrantedAt: null,
    consentRevokedAt: "2026-05-10T00:00:00.000Z",
  };

  it("operational + revoked-but-unstamped → block (consent_revoked)", () => {
    expect(evaluateConsentGate({ contact: revokedUnstamped, messageClass: "operational" })).toEqual(
      { action: "block", status: "revoked", reasonCode: "consent_revoked" },
    );
  });

  it("proactive + revoked-but-unstamped → block (consent_revoked)", () => {
    expect(evaluateConsentGate({ contact: revokedUnstamped, messageClass: "proactive" })).toEqual({
      action: "block",
      status: "revoked",
      reasonCode: "consent_revoked",
    });
  });
});
