/**
 * channel-gateway-consent-enforcement.test.ts
 *
 * Integration tests for the outbound consent enforcement gate wired into
 * ChannelGateway.dispatchResponse. Exercises six load-bearing scenarios:
 *
 * 1. Revoked contact → suppress outbound, persist metadata-only marker.
 * 2. Active contact → send normally, no verdict.
 * 3. Normal successful response IS gated (safety invariant — blocks regression
 *    where gate moves outside response.ok branch).
 * 4. Framework-generated technical-failure fallback is NOT gated (blocks
 *    regression where narrow exemption is accidentally removed).
 * 5. Verdict persistence failure does not crash dispatch.
 * 6. No consentEnforcementGate config → backward-compat, existing behavior unchanged.
 */

import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";

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

const INBOUND_MESSAGE: IncomingChannelMessage = {
  channel: "web_widget",
  token: "tok",
  sessionId: "sess-ceg-1",
  text: "Hi there",
};

const AGENT_RESPONSE_TEXT = "Hi there, how can I help you today?";

const FALLBACK_MESSAGE = "I'm having trouble right now. Let me connect you with the team.";

/** Build a minimal ChannelGatewayConfig with consentEnforcementGate wired. */
function makeConfig(opts: {
  revokedAt: Date | null;
  platformOk?: boolean;
  verdictSave?: ReturnType<typeof vi.fn>;
  addMessage?: ReturnType<typeof vi.fn>;
  sendSpy?: ReturnType<typeof vi.fn>;
  includeGate?: boolean;
}): {
  config: ChannelGatewayConfig;
  sendSpy: ReturnType<typeof vi.fn>;
  addMessage: ReturnType<typeof vi.fn>;
  verdictSave: ReturnType<typeof vi.fn>;
} {
  const sendSpy = opts.sendSpy ?? vi.fn().mockResolvedValue(undefined);
  const addMessage = opts.addMessage ?? vi.fn().mockResolvedValue(undefined);
  const verdictSave = opts.verdictSave ?? vi.fn().mockResolvedValue(undefined);
  const platformOk = opts.platformOk ?? true;
  const includeGate = opts.includeGate ?? true;

  const postureCache = new InMemoryGovernancePostureCache();
  const governanceConfigResolver = vi.fn().mockResolvedValue(SG_ENFORCE_RESOLUTION);
  const sessionContactResolver = vi.fn().mockResolvedValue("contact-ceg-1");
  const consentStore = {
    readOrNull: vi
      .fn()
      .mockResolvedValue(
        opts.revokedAt
          ? { consentRevokedAt: opts.revokedAt, pdpaJurisdiction: "SG" }
          : { consentRevokedAt: null, pdpaJurisdiction: "SG" },
      ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const platformIngress = {
    submit: vi.fn().mockResolvedValue(
      platformOk
        ? {
            ok: true,
            result: {
              outcome: "completed",
              outputs: { response: AGENT_RESPONSE_TEXT },
              summary: "OK",
              traceId: "trace-ceg-1",
            },
          }
        : {
            ok: false,
            error: { type: "execution_error", message: "Something went wrong" },
          },
    ),
  };

  const config: ChannelGatewayConfig = {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-ceg-1",
        messages: [],
      }),
      addMessage,
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue({
        deploymentId: "dep-ceg-1",
        listingId: "listing-ceg-1",
        organizationId: "org-ceg-1",
        skillSlug: "alex",
        trustLevel: "guided",
        trustScore: 50,
        inputConfig: {},
      }),
      resolveByDeploymentId: vi.fn(),
      resolveByOrgAndSlug: vi.fn(),
    },
    platformIngress,
    approvalStore: {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn(),
      listPending: vi.fn().mockResolvedValue([]),
    },
    ...(includeGate
      ? {
          consentEnforcementGate: {
            governanceConfigResolver,
            consentStore,
            postureCache,
            sessionContactResolver,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verdictStore: { save: verdictSave } as any,
            clock: () => new Date("2026-05-16T12:00:00Z"),
          },
        }
      : {}),
  };

  return { config, sendSpy, addMessage, verdictSave };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChannelGateway — consent enforcement at dispatch", () => {
  it("1. suppresses outbound and records metadata-only marker when contact is revoked", async () => {
    const { config, sendSpy, addMessage, verdictSave } = makeConfig({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
    });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy });

    // replySink.send must NOT be called — message is suppressed.
    expect(sendSpy).not.toHaveBeenCalled();

    // Transcript marker must be metadata-only — must NOT contain the generated text.
    expect(addMessage).toHaveBeenCalledWith(
      "conv-ceg-1",
      "assistant",
      "[suppressed:consent_revoked]",
    );
    expect(addMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      "assistant",
      expect.stringContaining(AGENT_RESPONSE_TEXT),
    );

    // Verdict must be persisted with correct shape.
    expect(verdictSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGuard: "consent_gate",
        action: "block",
        reasonCode: "consent_revoked",
      }),
    );
  });

  it("2. sends a normal agent-authored response when consent is active", async () => {
    const { config, sendSpy, verdictSave } = makeConfig({ revokedAt: null });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy });

    // Send IS called with the agent response text.
    expect(sendSpy).toHaveBeenCalledWith(AGENT_RESPONSE_TEXT);
    // No consent_revoked verdict when consent is active.
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("3. PROVES a normal successful assistant response IS gated (load-bearing safety invariant)", async () => {
    // This test is intentionally structurally similar to test 1.
    // Its purpose is to guard against future regressions where someone moves
    // the gate call outside the response.ok branch — making successful assistant
    // responses bypass consent enforcement entirely. Duplication is intentional.
    const { config, sendSpy, addMessage, verdictSave } = makeConfig({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      platformOk: true,
    });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy });

    // Gate fired: send suppressed, marker written, verdict persisted.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      "conv-ceg-1",
      "assistant",
      "[suppressed:consent_revoked]",
    );
    expect(verdictSave).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGuard: "consent_gate", action: "block" }),
    );
  });

  it("4. PROVES the framework-generated technical-failure fallback is NOT gated (narrow exemption invariant)", async () => {
    // Load-bearing safety test. The non-ok branch (I'm having trouble...) intentionally
    // bypasses the consent gate. This test guards that exemption from being
    // accidentally removed, which would block users from ever receiving error
    // notices when consent has been revoked.
    //
    // Setup: revoked consent + platformIngress returns { ok: false }.
    // Assert: replySink.send IS called with the canonical fallback message;
    //         no consent_revoked verdict recorded; no suppressed marker.
    const { config, sendSpy, verdictSave, addMessage } = makeConfig({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      platformOk: false,
    });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy });

    // Technical fallback IS sent despite revoked consent.
    expect(sendSpy).toHaveBeenCalledWith(FALLBACK_MESSAGE);
    // No consent enforcement verdict triggered (gate only runs in response.ok branch).
    expect(verdictSave).not.toHaveBeenCalled();
    // No suppressed:consent_revoked marker in transcript.
    expect(addMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      "assistant",
      "[suppressed:consent_revoked]",
    );
  });

  it("5. does not crash dispatch if verdict persistence throws", async () => {
    const failingVerdictSave = vi.fn().mockRejectedValue(new Error("verdict store down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { config, sendSpy, addMessage } = makeConfig({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      verdictSave: failingVerdictSave,
    });
    const gateway = new ChannelGateway(config);

    // Must not throw.
    await expect(
      gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy }),
    ).resolves.toBeUndefined();

    // Block decision is honored even when audit fails — send still NOT called.
    expect(sendSpy).not.toHaveBeenCalled();

    // Suppressed marker written even though verdict persistence failed
    // (gate catches the error and still returns "blocked").
    expect(addMessage).toHaveBeenCalledWith(
      expect.any(String),
      "assistant",
      "[suppressed:consent_revoked]",
    );

    // Error was logged.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("verdict persist failure"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("6. sends normally when consentEnforcementGate config is omitted (backward compat)", async () => {
    // Setup: no consentEnforcementGate in config. Existing behavior must be unchanged.
    const { config, sendSpy, verdictSave } = makeConfig({
      revokedAt: new Date("2026-05-15T00:00:00Z"), // would block if gate were wired
      includeGate: false,
    });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(INBOUND_MESSAGE, { send: sendSpy });

    // Gate is opt-in — without config, send proceeds normally.
    expect(sendSpy).toHaveBeenCalledWith(AGENT_RESPONSE_TEXT);
    // No verdict persisted (gate not even invoked).
    expect(verdictSave).not.toHaveBeenCalled();
  });
});
