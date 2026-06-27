import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import { buildWhatsAppSendContext, getRecoverySendContext } from "./whatsapp-send-context.js";
import { evaluateRecoveryEligibility } from "./robin-recovery-send-core.js";

/**
 * Robin behavioural eval lane (EV-7 / INFRA-3 Robin). Robin had NO eval harness: the
 * recovery send path's window/opt-in gate was unexercised end-to-end. This drives the
 * REAL `getRecoverySendContext` thread-read → context-assembly → `evaluateRecoveryEligibility`
 * chain (no injected eligibility) over a mock Prisma, and asserts a no-show contact whose real
 * thread state yields no opt-in resolves `no_optin`. Deterministic, no key, no Postgres — runs
 * in the blocking apps/api unit lane.
 *
 * Teeth (RED-prove): the SAME contact flips OFF `no_optin` when EITHER the real thread read
 * returns a fresh inbound OR messagingOptIn is granted, and a revoked contact blocks with a
 * DIFFERENT reason — so the `no_optin` assertion is not a constant.
 */

const ORG_ID = "org_clinic_1";
const CONTACT_ID = "contact_noshow_1";
const GRANTED_AT = new Date("2026-01-01T00:00:00.000Z");
/** The re-engagement-offer SG template's Meta name (the only marketing recovery template, SG). */
const RE_ENGAGEMENT_SG_META = "alex_re_engagement_offer_sg_v1";
const ONE_HOUR_MS = 60 * 60 * 1000;

interface ContactRow {
  name: string | null;
  phone: string | null;
  messagingOptIn: boolean;
  pdpaJurisdiction: "SG" | "MY" | null;
  consentGrantedAt: Date | null;
  consentRevokedAt: Date | null;
}
interface OrgRow {
  name: string | null;
  runtimeConfig: unknown;
}

function mockPrisma(rows: {
  contact: ContactRow | null;
  org: OrgRow | null;
  thread: { lastWhatsAppInboundAt: Date | null } | null;
}): {
  prisma: PrismaClient;
  threadFindUnique: ReturnType<typeof vi.fn>;
  contactFindFirst: ReturnType<typeof vi.fn>;
} {
  const threadFindUnique = vi.fn().mockResolvedValue(rows.thread);
  const contactFindFirst = vi.fn().mockResolvedValue(rows.contact);
  const orgFindUnique = vi.fn().mockResolvedValue(rows.org);
  const prisma = {
    contact: { findFirst: contactFindFirst },
    organizationConfig: { findUnique: orgFindUnique },
    conversationThread: { findUnique: threadFindUnique },
  } as unknown as PrismaClient;
  return { prisma, threadFindUnique, contactFindFirst };
}

/** A consenting past patient (granted PDPA, SG) — the realistic recovery-cohort shape.
 * Consent is GRANTED so the chain reaches the opt-in/window gate (where no_optin is decided)
 * rather than blocking earlier at the consent gate. */
const consentedNoShowContact = (messagingOptIn: boolean): ContactRow => ({
  name: "Jamie Tan",
  phone: "+6591234567",
  messagingOptIn,
  pdpaJurisdiction: "SG",
  consentGrantedAt: GRANTED_AT,
  consentRevokedAt: null,
});

/** An org whose runtimeConfig marks the SG re-engagement template Meta-approved, so the
 * window-gate is the ONLY thing standing between blocked and eligible. */
const orgWithApprovedReEngagement: OrgRow = {
  name: "Glow Aesthetics",
  runtimeConfig: { whatsappTemplateApprovals: { [RE_ENGAGEMENT_SG_META]: "approved" } },
};

describe("Robin recovery no-show send: window-gate behavioural lane (EV-7)", () => {
  it("a no-opt-in contact with no prior inbound resolves no_optin end-to-end (real thread read)", async () => {
    const { prisma, threadFindUnique } = mockPrisma({
      contact: consentedNoShowContact(false),
      org: orgWithApprovedReEngagement,
      thread: null, // no conversation thread yet (a CTWA-only / web-form no-show lead)
    });

    const ctx = await getRecoverySendContext(prisma, ORG_ID, CONTACT_ID);

    // The REAL thread read ran, org-scoped, by the contactId+org compound key.
    expect(threadFindUnique).toHaveBeenCalledWith({
      where: { contactId_organizationId: { contactId: CONTACT_ID, organizationId: ORG_ID } },
      select: { lastWhatsAppInboundAt: true },
    });
    // The context faithfully reflects the read: no inbound, no opt-in, consent granted.
    expect(ctx.lastWhatsAppInboundAt).toBeNull();
    expect(ctx.messagingOptIn).toBe(false);
    expect(ctx.consentGrantedAt).toBe(GRANTED_AT);

    // End-to-end through the REAL recovery eligibility wrapper (not an injected verdict).
    expect(evaluateRecoveryEligibility(ctx)).toEqual({ eligible: false, reason: "no_optin" });
  });

  it("a stale (>24h) prior inbound still resolves no_optin when opt-in is absent", async () => {
    const stale = new Date(Date.now() - 48 * ONE_HOUR_MS);
    const { prisma } = mockPrisma({
      contact: consentedNoShowContact(false),
      org: orgWithApprovedReEngagement,
      thread: { lastWhatsAppInboundAt: stale },
    });

    const ctx = await getRecoverySendContext(prisma, ORG_ID, CONTACT_ID);

    expect(ctx.lastWhatsAppInboundAt).toEqual(stale);
    expect(evaluateRecoveryEligibility(ctx)).toEqual({ eligible: false, reason: "no_optin" });
  });

  it("RED-prove: the SAME no-opt-in contact with a FRESH inbound (real thread read) flips to eligible", async () => {
    const fresh = new Date(Date.now() - ONE_HOUR_MS); // inside the WhatsApp 24h window
    const { prisma } = mockPrisma({
      contact: consentedNoShowContact(false), // messagingOptIn STILL false
      org: orgWithApprovedReEngagement,
      thread: { lastWhatsAppInboundAt: fresh },
    });

    const ctx = await getRecoverySendContext(prisma, ORG_ID, CONTACT_ID);
    const elig = evaluateRecoveryEligibility(ctx);

    // The ONLY input that changed vs. the no_optin case is the thread's inbound timestamp,
    // proving the verdict is driven by the real thread read, not a constant.
    expect(elig.eligible).toBe(true);
    if (elig.eligible) expect(elig.template.metaTemplateName).toBe(RE_ENGAGEMENT_SG_META);
  });

  it("RED-prove: granting messagingOptIn (no inbound) also flips no_optin → eligible", async () => {
    const { prisma } = mockPrisma({
      contact: consentedNoShowContact(true), // opt-in TRUE
      org: orgWithApprovedReEngagement,
      thread: null,
    });

    const ctx = await getRecoverySendContext(prisma, ORG_ID, CONTACT_ID);
    expect(ctx.messagingOptIn).toBe(true);
    expect(evaluateRecoveryEligibility(ctx).eligible).toBe(true);
  });

  it("a revoked contact blocks at the consent gate (consent_revoked), not no_optin", async () => {
    const { prisma } = mockPrisma({
      // Revocation must win even with a fresh inbound that would otherwise pass the window gate.
      contact: {
        ...consentedNoShowContact(false),
        consentRevokedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
      org: orgWithApprovedReEngagement,
      thread: { lastWhatsAppInboundAt: new Date(Date.now() - ONE_HOUR_MS) },
    });

    const ctx = await getRecoverySendContext(prisma, ORG_ID, CONTACT_ID);
    expect(evaluateRecoveryEligibility(ctx)).toEqual({
      eligible: false,
      reason: "consent_revoked",
    });
  });
});

describe("buildWhatsAppSendContext", () => {
  it("falls back to safe defaults when the contact/org rows are absent", async () => {
    const { prisma } = mockPrisma({ contact: null, org: null, thread: null });

    const ctx = await buildWhatsAppSendContext(prisma, ORG_ID, CONTACT_ID, null);

    expect(ctx.leadName).toBe("there");
    expect(ctx.businessName).toBe("our clinic");
    expect(ctx.messagingOptIn).toBe(false);
    expect(ctx.phone).toBeNull();
    expect(ctx.pdpaJurisdiction).toBeNull();
  });
});
