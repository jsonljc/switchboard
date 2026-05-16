import { resolveConsentStateConfig, type PdpaJurisdiction } from "@switchboard/schemas";
import type { ConsentStateStore } from "../consent/consent-store.js";
import type { GovernanceConfigResolver } from "../governance/governance-config-resolver.js";
import type { GovernanceVerdictStore } from "../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../governance/posture-cache.js";

export interface ConsentEnforcementGateConfig {
  governanceConfigResolver: GovernanceConfigResolver;
  consentStore: ConsentStateStore;
  postureCache: GovernancePostureCache;
  verdictStore: GovernanceVerdictStore;
  sessionContactResolver: (sessionId: string) => Promise<string | null>;
  clock: () => Date;
}

export interface RunConsentEnforcementGateInput {
  cfg: ConsentEnforcementGateConfig;
  outboundText: string;
  sessionId: string;
  deploymentId: string;
  channel: string;
}

/**
 * Pre-output consent enforcement gate. Runs immediately before
 * `replySink.send(...)` in ChannelGateway.dispatchResponse.
 *
 * Returns:
 *  - "blocked" → revocation in effect; caller MUST suppress the outbound
 *    (no replySink.send, no addMessage). Verdict already persisted.
 *  - "allowed" → continue with normal dispatch.
 *
 * Backward-compatible: when ConsentStateConfig.mode === "off" or governance
 * config is missing/erroring without an enforce-cached posture, the gate
 * is a pass-through ("allowed").
 */
export async function runConsentEnforcementGate(
  input: RunConsentEnforcementGateInput,
): Promise<"allowed" | "blocked"> {
  const { cfg, outboundText, sessionId, deploymentId, channel } = input;

  const resolution = await cfg.governanceConfigResolver(deploymentId);
  if (resolution.status === "missing") return "allowed";

  if (resolution.status === "error") {
    const cached = cfg.postureCache.lastKnown(deploymentId);
    if (cached?.mode === "enforce") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (cfg.verdictStore.save as any)({
          deploymentId,
          sourceGuard: "consent_gate",
          action: "allow",
          reasonCode: "governance_unavailable",
          jurisdiction: cached.jurisdiction,
          clinicType: cached.clinicType,
          conversationId: sessionId,
          decidedAt: cfg.clock().toISOString(),
          details: { event: "egress_resolver_error_fail_open", channel },
          auditLevel: "critical",
        });
      } catch (err) {
        console.error("[consent-enforcement-gate] verdict persist failure", err);
      }
    }
    return "allowed";
  }

  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return "allowed";

  cfg.postureCache.remember(deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  const contactId = await cfg.sessionContactResolver(sessionId);
  if (!contactId) return "allowed"; // pre-contact outbound (e.g., system error reply)

  const consent = await cfg.consentStore.readOrNull(contactId);
  if (!consent?.consentRevokedAt) return "allowed";

  // Revoked — emit verdict.
  const jurisdiction = (consent.pdpaJurisdiction ??
    resolution.config.jurisdiction) as PdpaJurisdiction;

  const verdictAction = consentConfig.mode === "enforce" ? "block" : "allow";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cfg.verdictStore.save as any)({
      deploymentId,
      sourceGuard: "consent_gate",
      action: verdictAction,
      reasonCode: "consent_revoked",
      jurisdiction,
      clinicType: resolution.config.clinicType,
      conversationId: sessionId,
      decidedAt: cfg.clock().toISOString(),
      details: {
        event: "outbound_blocked_revoked",
        channel,
        contactId,
        outboundLength: outboundText.length,
        observe: consentConfig.mode === "observe",
      },
      auditLevel: "critical",
    });
  } catch (err) {
    console.error("[consent-enforcement-gate] verdict persist failure", err);
  }

  if (consentConfig.mode === "observe") return "allowed";
  return "blocked";
}
