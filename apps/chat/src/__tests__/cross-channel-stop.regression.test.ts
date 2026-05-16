/**
 * cross-channel-stop.regression.test.ts
 *
 * Load-bearing regression test for the send-time consent enforcement spec.
 *
 * Contract: A contact who sends STOP on WhatsApp is revoked at the contact
 * level. Any subsequent agent-authored outbound on ANY channel (Telegram,
 * Instagram, Slack) MUST be suppressed by the consentEnforcementGate before
 * replySink.send() is called. GovernanceVerdict rows are persisted for each
 * blocked outbound.
 *
 * Architecture note: The inbound revocation gate (consentRevocationGate) calls
 * consentService.recordRevocation() when it detects a STOP keyword. The
 * outbound enforcement gate (consentEnforcementGate) reads from consentStore
 * directly. The two gates are linked by the shared ConsentStateStore — when
 * recordRevocation() is called, the store's readOrNull() must reflect the
 * revocation for enforcement to fire on subsequent outbound dispatches.
 *
 * This test wires both gates against a shared in-memory consentState object
 * that is mutated by the recordRevocation mock, proving the cross-channel
 * propagation path end-to-end without a real Postgres connection.
 */

import { describe, it, expect, vi } from "vitest";
import { ChannelGateway, loadRevocationKeywords } from "@switchboard/core";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "@switchboard/core";
import { InMemoryGovernancePostureCache } from "@switchboard/core/skill-runtime";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SG_ENFORCE_RESOLUTION = {
  status: "resolved" as const,
  config: {
    jurisdiction: "SG" as const,
    clinicType: "medical" as const,
    deterministicGate: { mode: "off" as const },
    consentState: { mode: "enforce" as const },
  },
};

const DEPLOYMENT_RESULT = {
  deploymentId: "dep-cross-1",
  listingId: "listing-cross-1",
  organizationId: "org-cross-1",
  skillSlug: "alex",
  trustLevel: "guided" as const,
  trustScore: 50,
  inputConfig: {},
};

const AGENT_REPLY = "Hi, how can I help you today?";

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("cross-channel STOP regression", () => {
  it("STOP on WhatsApp blocks subsequent outbound on Telegram, Instagram, Slack", async () => {
    const contactId = "contact-cross-1";

    // Shared consent state — starts active, mutated to revoked when recordRevocation fires.
    const consentState = {
      consentRevokedAt: null as Date | null,
      pdpaJurisdiction: "SG" as const,
    };

    // consentStore.readOrNull reads the shared state (used by consentEnforcementGate).
    const consentStore = {
      readOrNull: vi.fn(async (_cid: string) => ({ ...consentState })),
      setJurisdictionIfNull: vi.fn().mockResolvedValue(undefined),
      setDisclosure: vi.fn().mockResolvedValue(undefined),
      setGrant: vi.fn().mockResolvedValue(undefined),
      setRevocationIfNotRevoked: vi.fn(async () => {
        consentState.consentRevokedAt = new Date("2026-05-16T12:00:00Z");
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }),
      clearConsentTimestamps: vi
        .fn()
        .mockResolvedValue({ previousGrantedAt: null, previousRevokedAt: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // consentService.recordRevocation — called by inbound revocation gate when STOP detected.
    // Mutates consentState so that subsequent consentStore.readOrNull() returns revoked.
    const consentService = {
      attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
      recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
      recordGrant: vi.fn().mockResolvedValue(undefined),
      recordRevocation: vi.fn(async () => {
        consentState.consentRevokedAt = new Date("2026-05-16T12:00:00Z");
      }),
      clearConsent: vi.fn().mockResolvedValue(undefined),
    };

    // Session-to-contact map: all four sessions resolve to the same contactId,
    // proving that consent revocation is contact-keyed, not channel-keyed.
    const sessionMap = new Map<string, string>([
      ["wa-session", contactId],
      ["tg-session", contactId],
      ["ig-session", contactId],
      ["slack-session", contactId],
    ]);
    const sessionContactResolver = vi.fn(
      async (sessionId: string) => sessionMap.get(sessionId) ?? null,
    );

    const governanceConfigResolver = vi.fn().mockResolvedValue(SG_ENFORCE_RESOLUTION);
    const postureCache = new InMemoryGovernancePostureCache();
    const verdictSave = vi.fn().mockResolvedValue(undefined);
    const verdictStore = {
      save: verdictSave,
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Per-channel reply sinks — we assert on these to verify suppression.
    const replySinks = {
      whatsapp: { send: vi.fn().mockResolvedValue(undefined) },
      telegram: { send: vi.fn().mockResolvedValue(undefined) },
      instagram: { send: vi.fn().mockResolvedValue(undefined) },
      slack: { send: vi.fn().mockResolvedValue(undefined) },
    };

    // platformIngress returns a successful agent response for any inbound
    // (so suppression must come from the enforcement gate, not platform failure).
    const platformIngress = {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: AGENT_REPLY },
          summary: "OK",
          traceId: "trace-cross-1",
        },
      }),
    };

    const config: ChannelGatewayConfig = {
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-cross-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      deploymentResolver: {
        resolveByChannelToken: vi.fn().mockResolvedValue(DEPLOYMENT_RESULT),
        resolveByDeploymentId: vi.fn().mockResolvedValue(DEPLOYMENT_RESULT),
        resolveByOrgAndSlug: vi.fn().mockResolvedValue(DEPLOYMENT_RESULT),
      },
      platformIngress,
      approvalStore: {
        save: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn().mockResolvedValue(undefined),
        listPending: vi.fn().mockResolvedValue([]),
      },
      // Inbound consent revocation gate — fires on "STOP" keyword, calls
      // consentService.recordRevocation which mutates consentState.
      consentRevocationGate: {
        governanceConfigResolver,
        consentService,
        postureCache,
        revocationKeywordLoader: loadRevocationKeywords,
        sessionContactResolver,
        verdictStore,
        clock: () => new Date("2026-05-16T12:00:00Z"),
      },
      // Outbound consent enforcement gate — reads consentStore.readOrNull
      // which reflects the mutated consentState after recordRevocation fires.
      consentEnforcementGate: {
        governanceConfigResolver,
        consentStore,
        postureCache,
        sessionContactResolver,
        verdictStore,
        clock: () => new Date("2026-05-16T12:00:00Z"),
      },
    };

    const gateway = new ChannelGateway(config);

    // -----------------------------------------------------------------------
    // Step 1: STOP on WhatsApp.
    // The inbound revocation gate detects "STOP", calls recordRevocation,
    // and sends the ack — this is the expected inbound gate behavior.
    // -----------------------------------------------------------------------
    const waStopMessage: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok-wa",
      sessionId: "wa-session",
      text: "STOP",
    };
    await gateway.handleIncoming(waStopMessage, replySinks.whatsapp);

    // Revocation must be recorded — the inbound gate fired.
    expect(consentService.recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId,
        source: "inbound_keyword_revocation",
        openConversationSessionId: "wa-session",
      }),
    );
    // Shared consent state is now revoked.
    expect(consentState.consentRevokedAt).not.toBeNull();

    // WhatsApp ack was sent — expected inbound-gate behavior.
    expect(replySinks.whatsapp.send).toHaveBeenCalledTimes(1);

    // Reset submission spy for subsequent dispatches so assertions are clean.
    platformIngress.submit.mockClear();

    // -----------------------------------------------------------------------
    // Step 2: Same contact sends "hi" on Telegram.
    // platformIngress.submit returns a successful response, but the
    // consentEnforcementGate must suppress replySink.send.
    // -----------------------------------------------------------------------
    await gateway.handleIncoming(
      { channel: "telegram", token: "tok-tg", sessionId: "tg-session", text: "hi" },
      replySinks.telegram,
    );
    expect(replySinks.telegram.send).not.toHaveBeenCalled();

    // -----------------------------------------------------------------------
    // Step 3: Same contact sends "hi" on Instagram — also blocked.
    // -----------------------------------------------------------------------
    await gateway.handleIncoming(
      { channel: "instagram", token: "tok-ig", sessionId: "ig-session", text: "hi" },
      replySinks.instagram,
    );
    expect(replySinks.instagram.send).not.toHaveBeenCalled();

    // -----------------------------------------------------------------------
    // Step 4: Same contact sends "hi" on Slack — also blocked.
    // -----------------------------------------------------------------------
    await gateway.handleIncoming(
      { channel: "slack", token: "tok-slack", sessionId: "slack-session", text: "hi" },
      replySinks.slack,
    );
    expect(replySinks.slack.send).not.toHaveBeenCalled();

    // -----------------------------------------------------------------------
    // Step 5: Verify GovernanceVerdict was persisted for each blocked outbound.
    // 3 blocked channels → 3 consent_revoked verdict calls.
    // (WhatsApp STOP triggers a verdict via the inbound gate, not here.)
    // -----------------------------------------------------------------------
    const consentRevokedVerdicts = verdictSave.mock.calls.filter(
      (call) => call[0]?.reasonCode === "consent_revoked" && call[0]?.action === "block",
    );
    expect(consentRevokedVerdicts).toHaveLength(3);

    // Each blocked verdict must name the correct channel.
    const blockedChannels = consentRevokedVerdicts.map((call) => call[0]?.details?.channel);
    expect(blockedChannels).toContain("telegram");
    expect(blockedChannels).toContain("instagram");
    expect(blockedChannels).toContain("slack");

    // -----------------------------------------------------------------------
    // Step 6: Confirm platformIngress was invoked for each subsequent channel
    // (suppression happens after submit — the gate is pre-send, not pre-submit).
    // -----------------------------------------------------------------------
    expect(platformIngress.submit).toHaveBeenCalledTimes(3);
  });
});
