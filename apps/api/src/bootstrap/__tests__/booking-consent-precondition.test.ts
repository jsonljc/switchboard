import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryGovernancePostureCache,
  enforceConsentPrecondition,
  type GovernanceConfigResolver,
} from "@switchboard/core/skill-runtime";
import {
  setMetrics,
  createInMemoryMetrics,
  getMetrics,
  type ContactConsentReader,
} from "@switchboard/core";
import { createBookingConsentPrecondition } from "../booking-consent-precondition.js";

const DEP = "dep_a19";
const ORG = "org_a19";
const CONTACT = "contact_a19";

// vi.fn is untyped, so a partial config need not satisfy the full GovernanceConfig
// (mirrors packages/core .../hooks/__tests__/pdpa-consent-gate.test.ts).
function resolverReturning(resolution: unknown): GovernanceConfigResolver {
  return vi.fn().mockResolvedValue(resolution) as unknown as GovernanceConfigResolver;
}

function stubReader(): ContactConsentReader {
  return { read: vi.fn().mockResolvedValue({}) } as unknown as ContactConsentReader;
}

function make(resolution: unknown, cache = new InMemoryGovernancePostureCache()) {
  const reader = stubReader();
  const pre = createBookingConsentPrecondition({
    governanceConfigResolver: resolverReturning(resolution),
    consentPostureCache: cache,
    contactConsentReader: reader,
  });
  return { pre, reader, cache };
}

const RESOLVED = (mode: string) => ({
  status: "resolved",
  config: { jurisdiction: "SG", clinicType: "medical", consentState: { mode } },
});

const warm = (mode: string) => {
  const c = new InMemoryGovernancePostureCache();
  c.remember(DEP, { mode, jurisdiction: "SG", clinicType: "medical" } as never);
  return c;
};

describe("createBookingConsentPrecondition.resolveMode", () => {
  beforeEach(() => setMetrics(createInMemoryMetrics()));

  it("returns the resolved consentState mode when status === resolved (enforce)", async () => {
    expect(await make(RESOLVED("enforce")).pre.resolveMode(DEP)).toBe("enforce");
  });

  it("returns off when status === resolved with consentState mode off", async () => {
    expect(await make(RESOLVED("off")).pre.resolveMode(DEP)).toBe("off");
  });

  it("returns off when status === missing (gate not enrolled)", async () => {
    expect(await make({ status: "missing" }).pre.resolveMode(DEP)).toBe("off");
  });

  it("FAILS CLOSED to enforce on status === error when a warm enforce posture is cached", async () => {
    const { pre } = make({ status: "error", error: new Error("db down") }, warm("enforce"));
    expect(await pre.resolveMode(DEP)).toBe("enforce");
  });

  it("falls open to off on status === error when the posture cache is cold", async () => {
    const { pre } = make({ status: "error", error: new Error("db down") });
    expect(await pre.resolveMode(DEP)).toBe("off");
  });

  it("does NOT fail closed on error when the cached posture is observe (only enforce closes)", async () => {
    const { pre } = make({ status: "error", error: new Error("db down") }, warm("observe"));
    expect(await pre.resolveMode(DEP)).toBe("off");
  });

  it("increments bookingConsentResolverError with outcome=enforce_from_cache on a warm-enforce error", async () => {
    const spy = vi.spyOn(getMetrics().bookingConsentResolverError, "inc");
    const { pre } = make({ status: "error", error: new Error("x") }, warm("enforce"));
    await pre.resolveMode(DEP);
    expect(spy).toHaveBeenCalledWith({ deploymentId: DEP, outcome: "enforce_from_cache" });
  });

  it("increments bookingConsentResolverError with outcome=off_cold_cache on a cold-cache error", async () => {
    const spy = vi.spyOn(getMetrics().bookingConsentResolverError, "inc");
    const { pre } = make({ status: "error", error: new Error("x") });
    await pre.resolveMode(DEP);
    expect(spy).toHaveBeenCalledWith({ deploymentId: DEP, outcome: "off_cold_cache" });
  });

  it("does NOT increment the resolver-error counter on the resolved happy path", async () => {
    const spy = vi.spyOn(getMetrics().bookingConsentResolverError, "inc");
    await make(RESOLVED("enforce")).pre.resolveMode(DEP);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("createBookingConsentPrecondition.read", () => {
  it("delegates to the injected contactConsentReader with org + contact", async () => {
    const { pre, reader } = make({ status: "missing" });
    await pre.read(ORG, CONTACT);
    expect(reader.read).toHaveBeenCalledWith(ORG, CONTACT);
  });
});

// End-to-end seam: prove the error-fallback mode actually drives the core
// enforcement primitive (enforceConsentPrecondition) to block/allow as intended,
// not just that resolveMode returns the right string. Composes the REAL adapter
// with the REAL enforceConsentPrecondition (no calendar-book fixture needed).
function readerWith(state: {
  pdpaJurisdiction: "SG" | "MY" | null;
  consentGrantedAt: string | null;
  consentRevokedAt: string | null;
}): ContactConsentReader {
  return { read: vi.fn().mockResolvedValue(state) } as unknown as ContactConsentReader;
}

const IDS = { deploymentId: DEP, orgId: ORG, contactId: CONTACT };
const PENDING = { pdpaJurisdiction: "SG" as const, consentGrantedAt: null, consentRevokedAt: null };
const GRANTED = {
  pdpaJurisdiction: "SG" as const,
  consentGrantedAt: "2026-01-01T00:00:00.000Z",
  consentRevokedAt: null,
};

describe("seam: error-fallback mode drives enforceConsentPrecondition end-to-end", () => {
  beforeEach(() => setMetrics(createInMemoryMetrics()));

  it("resolver error + warm enforce + PENDING consent BLOCKS the booking (CONSENT_REQUIRED)", async () => {
    const pre = createBookingConsentPrecondition({
      governanceConfigResolver: resolverReturning({ status: "error", error: new Error("db down") }),
      consentPostureCache: warm("enforce"),
      contactConsentReader: readerWith(PENDING),
    });
    const result = await enforceConsentPrecondition(pre, IDS);
    expect(result?.status).toBe("error");
    expect(result?.error?.code).toBe("CONSENT_REQUIRED");
  });

  it("resolver error + warm enforce + GRANTED consent ALLOWS the booking (no block)", async () => {
    const pre = createBookingConsentPrecondition({
      governanceConfigResolver: resolverReturning({ status: "error", error: new Error("db down") }),
      consentPostureCache: warm("enforce"),
      contactConsentReader: readerWith(GRANTED),
    });
    expect(await enforceConsentPrecondition(pre, IDS)).toBeNull();
  });

  it("resolver error + COLD cache stays inert: off short-circuits before any consent read", async () => {
    const reader = readerWith(PENDING);
    const pre = createBookingConsentPrecondition({
      governanceConfigResolver: resolverReturning({ status: "error", error: new Error("db down") }),
      consentPostureCache: new InMemoryGovernancePostureCache(),
      contactConsentReader: reader,
    });
    expect(await enforceConsentPrecondition(pre, IDS)).toBeNull();
    expect(reader.read as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
