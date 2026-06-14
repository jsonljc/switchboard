import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GovernanceMode } from "@switchboard/schemas";
import { setMetrics, createInMemoryMetrics } from "../../telemetry/metrics.js";
import { enforceConsentPrecondition } from "./calendar-book-consent.js";
import type { BookingConsentState, ConsentPrecondition } from "./calendar-book-consent.js";

const IDS = { deploymentId: "dep_1", orgId: "org_1", contactId: "ct_1" };

const GRANTED: BookingConsentState = {
  pdpaJurisdiction: "SG",
  consentGrantedAt: "2026-04-01T00:00:00.000Z",
  consentRevokedAt: null,
};
const PENDING: BookingConsentState = {
  pdpaJurisdiction: "SG",
  consentGrantedAt: null,
  consentRevokedAt: null,
};
const REVOKED: BookingConsentState = {
  pdpaJurisdiction: "SG",
  consentGrantedAt: "2026-04-01T00:00:00.000Z",
  consentRevokedAt: "2026-04-02T00:00:00.000Z",
};
// No PDPA jurisdiction => not_applicable => allowed even under enforce.
const NOT_APPLICABLE: BookingConsentState = {
  pdpaJurisdiction: null,
  consentGrantedAt: null,
  consentRevokedAt: null,
};

describe("enforceConsentPrecondition", () => {
  let resolveMode: ReturnType<typeof vi.fn<(deploymentId: string) => Promise<GovernanceMode>>>;
  let read: ReturnType<
    typeof vi.fn<(orgId: string, contactId: string) => Promise<BookingConsentState>>
  >;
  let precondition: ConsentPrecondition;

  beforeEach(() => {
    setMetrics(createInMemoryMetrics());
    resolveMode = vi.fn<(deploymentId: string) => Promise<GovernanceMode>>();
    read = vi.fn<(orgId: string, contactId: string) => Promise<BookingConsentState>>();
    precondition = { resolveMode, read };
  });

  // INERT-BY-DEFAULT: "off" must never even read consent.
  it("mode 'off': returns null without reading consent (zero overhead, inert)", async () => {
    resolveMode.mockResolvedValue("off");

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(resolveMode).toHaveBeenCalledWith("dep_1");
  });

  it("mode 'enforce' + pending consent: blocks with CONSENT_REQUIRED (non-retryable)", async () => {
    resolveMode.mockResolvedValue("enforce");
    read.mockResolvedValue(PENDING);

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result?.status).toBe("error");
    expect(result?.error?.code).toBe("CONSENT_REQUIRED");
    expect(result?.error?.retryable).toBe(false);
  });

  it("mode 'enforce' + revoked consent: blocks with CONSENT_REQUIRED", async () => {
    resolveMode.mockResolvedValue("enforce");
    read.mockResolvedValue(REVOKED);

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result?.error?.code).toBe("CONSENT_REQUIRED");
  });

  it("mode 'enforce' + granted consent: returns null (allowed)", async () => {
    resolveMode.mockResolvedValue("enforce");
    read.mockResolvedValue(GRANTED);

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result).toBeNull();
    expect(read).toHaveBeenCalledWith("org_1", "ct_1");
  });

  it("mode 'enforce' + not_applicable (no PDPA jurisdiction): returns null (allowed)", async () => {
    resolveMode.mockResolvedValue("enforce");
    read.mockResolvedValue(NOT_APPLICABLE);

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result).toBeNull();
  });

  it("mode 'observe' + pending consent: returns null (telemetry-only, never blocks)", async () => {
    resolveMode.mockResolvedValue("observe");
    read.mockResolvedValue(PENDING);

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result).toBeNull();
  });

  // FAIL-CLOSED: a read error under enforce must BLOCK (we cannot prove consent).
  it("mode 'enforce' + read throws: blocks (fail-closed)", async () => {
    resolveMode.mockResolvedValue("enforce");
    read.mockRejectedValue(new Error("contact not found"));

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result?.error?.code).toBe("CONSENT_REQUIRED");
  });

  it("mode 'observe' + read throws: returns null (never blocks)", async () => {
    resolveMode.mockResolvedValue("observe");
    read.mockRejectedValue(new Error("contact not found"));

    const result = await enforceConsentPrecondition(precondition, IDS);

    expect(result).toBeNull();
  });

  it("increments bookingConsentBlocked{reason} on an enforce block", async () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.bookingConsentBlocked, "inc");
    setMetrics(metrics);
    resolveMode.mockResolvedValue("enforce");
    read.mockResolvedValue(PENDING);

    await enforceConsentPrecondition(precondition, IDS);

    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", reason: "consent_pending" });
  });
});
