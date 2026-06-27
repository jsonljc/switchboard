/**
 * EV-14 / CHAN-8 — cross-channel STOP is org+CONTACT-scoped.
 *
 * The companion `cross-channel-stop.regression.test.ts` proves a STOP propagates
 * across channels for the SAME contact. This proves the dual: a STOP for contact
 * A1 revokes ONLY A1 — a different contact in the same org (A2) and a contact in
 * another org (B1) keep receiving outbound. Consent is keyed by contactId (which
 * is itself org-scoped), so the revocation never bleeds across contacts or orgs.
 * Drives the REAL ChannelGateway. TEST-ONLY.
 */
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway, loadRevocationKeywords } from "@switchboard/core";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "@switchboard/core";
import { InMemoryGovernancePostureCache } from "@switchboard/core/skill-runtime";

const ENFORCE = {
  status: "resolved" as const,
  config: {
    jurisdiction: "SG" as const,
    clinicType: "medical" as const,
    deterministicGate: { mode: "off" as const },
    consentState: { mode: "enforce" as const },
  },
};

const CLOCK = () => new Date("2026-05-16T12:00:00Z");
const AGENT_REPLY = "Hi, how can I help you today?";

// Two orgs. A1 + A2 are distinct contacts in org A; B1 is a contact in org B.
const ORG_A = "org_A";
const ORG_B = "org_B";

function deploymentFor(orgId: string) {
  return {
    deploymentId: `dep-${orgId}`,
    listingId: `listing-${orgId}`,
    organizationId: orgId,
    skillSlug: "alex",
    trustLevel: "guided" as const,
    trustScore: 50,
    inputConfig: {},
  };
}

describe("CHAN-8 cross-channel STOP scoping", () => {
  it("a STOP for contact A1 revokes ONLY A1 — A2 (same org) and B1 (other org) still receive", async () => {
    // Per-contact consent state. Only the contact that sends STOP is mutated.
    const consentByContact: Record<
      string,
      { consentRevokedAt: Date | null; pdpaJurisdiction: "SG" }
    > = {
      contact_A1: { consentRevokedAt: null, pdpaJurisdiction: "SG" },
      contact_A2: { consentRevokedAt: null, pdpaJurisdiction: "SG" },
      contact_B1: { consentRevokedAt: null, pdpaJurisdiction: "SG" },
    };

    const consentStore = {
      readOrNull: vi.fn(async (contactId: string) =>
        consentByContact[contactId] ? { ...consentByContact[contactId] } : null,
      ),
      setJurisdictionIfNull: vi.fn().mockResolvedValue(undefined),
      setDisclosure: vi.fn().mockResolvedValue(undefined),
      setGrant: vi.fn().mockResolvedValue(undefined),
      setRevocationIfNotRevoked: vi.fn(async (contactId: string) => {
        const entry = consentByContact[contactId];
        if (entry) entry.consentRevokedAt = CLOCK();
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }),
      clearConsentTimestamps: vi
        .fn()
        .mockResolvedValue({ previousGrantedAt: null, previousRevokedAt: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const consentService = {
      attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
      recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
      recordGrant: vi.fn().mockResolvedValue(undefined),
      recordRevocation: vi.fn(async (input: { contactId: string }) => {
        const entry = consentByContact[input.contactId];
        if (entry) entry.consentRevokedAt = CLOCK();
      }),
      clearConsent: vi.fn().mockResolvedValue(undefined),
    };

    // Sessions -> contacts. Each session is its own contact; A-sessions are org A,
    // B-session is org B.
    const sessionToContact: Record<string, string> = {
      "wa-A1": "contact_A1",
      "tg-A1": "contact_A1",
      "tg-A2": "contact_A2",
      "tg-B1": "contact_B1",
    };
    const sessionToOrg: Record<string, string> = {
      "wa-A1": ORG_A,
      "tg-A1": ORG_A,
      "tg-A2": ORG_A,
      "tg-B1": ORG_B,
    };
    const sessionContactResolver = vi.fn(
      async (sessionId: string) => sessionToContact[sessionId] ?? null,
    );

    const governanceConfigResolver = vi.fn().mockResolvedValue(ENFORCE);
    const postureCache = new InMemoryGovernancePostureCache();
    const verdictStore = {
      save: vi.fn().mockResolvedValue(undefined),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const platformIngress = {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: AGENT_REPLY },
          summary: "OK",
          traceId: "trace-1",
        },
      }),
    };

    // Resolve the deployment by the session's org (token encodes which session).
    const resolveForSession = (sessionId: string) =>
      deploymentFor(sessionToOrg[sessionId] ?? ORG_A);

    const config: ChannelGatewayConfig = {
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      deploymentResolver: {
        resolveByChannelToken: vi.fn(async (_channel: string, token: string) =>
          resolveForSession(token),
        ),
        resolveByDeploymentId: vi.fn().mockResolvedValue(deploymentFor(ORG_A)),
        resolveByOrgAndSlug: vi.fn().mockResolvedValue(deploymentFor(ORG_A)),
      },
      platformIngress,
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
      consentRevocationGate: {
        governanceConfigResolver,
        consentService,
        postureCache,
        revocationKeywordLoader: loadRevocationKeywords,
        sessionContactResolver,
        verdictStore,
        clock: CLOCK,
      },
      consentEnforcementGate: {
        governanceConfigResolver,
        consentStore,
        postureCache,
        sessionContactResolver,
        verdictStore,
        clock: CLOCK,
      },
    };

    const gateway = new ChannelGateway(config);

    // The token doubles as the session id so the resolver can pick the org.
    const sink = () => ({ send: vi.fn().mockResolvedValue(undefined) });

    // Step 1 — contact A1 sends STOP on WhatsApp. A1 becomes revoked.
    const stop: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "wa-A1",
      sessionId: "wa-A1",
      text: "STOP",
    };
    const waSink = sink();
    await gateway.handleIncoming(stop, waSink);
    expect(consentService.recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "contact_A1" }),
    );
    expect(consentByContact.contact_A1!.consentRevokedAt).not.toBeNull();
    // The other contacts were NOT revoked by A1's STOP.
    expect(consentByContact.contact_A2!.consentRevokedAt).toBeNull();
    expect(consentByContact.contact_B1!.consentRevokedAt).toBeNull();

    platformIngress.submit.mockClear();

    // Step 2 — contact A1 messages again (Telegram): blocked (sanity the gate fires).
    const a1Sink = sink();
    await gateway.handleIncoming(
      { channel: "telegram", token: "tg-A1", sessionId: "tg-A1", text: "hi" },
      a1Sink,
    );
    expect(a1Sink.send).not.toHaveBeenCalled();

    // Step 3 — contact A2 (SAME org A, different contact) messages: NOT suppressed.
    const a2Sink = sink();
    await gateway.handleIncoming(
      { channel: "telegram", token: "tg-A2", sessionId: "tg-A2", text: "hi" },
      a2Sink,
    );
    expect(a2Sink.send).toHaveBeenCalledTimes(1);

    // Step 4 — contact B1 (DIFFERENT org B) messages: NOT suppressed.
    const b1Sink = sink();
    await gateway.handleIncoming(
      { channel: "telegram", token: "tg-B1", sessionId: "tg-B1", text: "hi" },
      b1Sink,
    );
    expect(b1Sink.send).toHaveBeenCalledTimes(1);

    // The two unaffected contacts were both submitted + delivered (suppression is
    // post-submit; A1 was submitted but blocked, A2 + B1 submitted + sent).
    expect(platformIngress.submit).toHaveBeenCalledTimes(3);
  });
});
