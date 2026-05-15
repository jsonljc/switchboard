/**
 * channel-gateway-consent-ordering.test.ts
 *
 * Regression guard for Phase 1c gate ordering invariant:
 * The consent revocation gate MUST run BEFORE the 1b-1 escalation gate.
 *
 * Test: when an inbound message contains BOTH a revocation keyword ("STOP")
 * AND a pregnancy trigger, recordRevocation is called (consent gate fired),
 * the escalationTriggerLoader is NOT invoked (escalation gate never reached),
 * and submit is NOT called (terminal short-circuit on revocation).
 */

import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import { loadRevocationKeywords } from "../../consent/revocation-keywords/loader.js";
import type { EscalationTriggerEntry } from "../../governance/escalation-triggers/types.js";

// ---------------------------------------------------------------------------
// Fixtures
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

const SG_TRIGGER_ENTRY: EscalationTriggerEntry = {
  id: "test-pg-sg",
  category: "pregnancy_breastfeeding",
  patterns: [/pregnant/i],
};

// This message contains BOTH a revocation keyword and a pregnancy trigger.
// The consent gate must fire first, short-circuiting before the escalation gate.
const MSG_BOTH: IncomingChannelMessage = {
  channel: "web_widget",
  token: "tok",
  sessionId: "sess-order",
  text: "STOP — also I am pregnant",
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("ChannelGateway — consent-before-escalation ordering", () => {
  it("consent revocation gate fires first; escalation gate is NOT reached", async () => {
    const postureCache = new InMemoryGovernancePostureCache();

    // Shared governance resolver returns enforce for both gates (same deploymentId).
    const governanceConfigResolver = vi.fn().mockResolvedValue(SG_ENFORCE_RESOLUTION);

    const recordRevocation = vi.fn().mockResolvedValue(undefined);
    const consentService = {
      attachToGovernedInteraction: vi.fn(),
      recordDisclosureShown: vi.fn(),
      recordGrant: vi.fn(),
      recordRevocation,
      clearConsent: vi.fn(),
    };

    const sessionContactResolver = vi.fn().mockResolvedValue("contact-123");

    const verdictStore = {
      save: vi.fn().mockResolvedValue({}),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
    };

    // The escalation trigger loader — if called, the test fails (ordering broken).
    const escalationTriggerLoader = vi.fn().mockReturnValue([SG_TRIGGER_ENTRY]) as (
      j: "SG" | "MY",
    ) => ReadonlyArray<EscalationTriggerEntry>;

    const submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { response: "Hello" }, summary: "OK" },
      workUnit: { id: "wu-1", traceId: "t-1" },
    });
    const sendSpy = vi.fn().mockResolvedValue(undefined);

    const config: ChannelGatewayConfig = {
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      deploymentResolver: {
        resolveByChannelToken: vi.fn().mockResolvedValue({
          deploymentId: "dep-order",
          listingId: "listing-1",
          organizationId: "org-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 50,
          inputConfig: {},
        }),
        resolveByDeploymentId: vi.fn(),
        resolveByOrgAndSlug: vi.fn(),
      },
      platformIngress: { submit: submitSpy },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn(),
        listPending: vi.fn().mockResolvedValue([]),
      },
      // 1b-1 escalation gate deps
      governanceConfigResolver,
      escalationTriggerLoader,
      verdictStore,
      postureCache,
      // 1c consent revocation gate deps
      consentRevocationGate: {
        governanceConfigResolver,
        consentService,
        postureCache,
        revocationKeywordLoader: loadRevocationKeywords,
        sessionContactResolver,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        verdictStore: verdictStore as any,
        clock: () => new Date("2026-05-11T10:00:00Z"),
      },
    };

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(MSG_BOTH, { send: sendSpy });

    // Consent gate fired: revocation recorded.
    expect(recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-123",
        source: "inbound_keyword_revocation",
        openConversationSessionId: "sess-order",
      }),
    );

    // Escalation gate NOT reached: trigger loader never called.
    expect(escalationTriggerLoader).not.toHaveBeenCalled();

    // Submit skipped: terminal short-circuit.
    expect(submitSpy).not.toHaveBeenCalled();

    // Ack sent to user.
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
