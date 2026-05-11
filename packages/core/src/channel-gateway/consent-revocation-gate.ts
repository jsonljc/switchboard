import { resolveConsentStateConfig, type PdpaJurisdiction } from "@switchboard/schemas";
import type { ChannelGatewayConfig, ReplySink } from "./types.js";
import { scanForRevocationKeywords } from "../consent/scanner/revocation-keyword-scanner.js";
import { REVOCATION_ACK } from "../consent/revocation-ack.js";

export interface RunConsentRevocationGateInput {
  cfg: NonNullable<ChannelGatewayConfig["consentRevocationGate"]>;
  inboundText: string;
  sessionId: string;
  deploymentId: string;
  organizationId: string;
  replySink: ReplySink;
}

/**
 * Pre-input consent revocation gate. Runs BEFORE the 1b-1 escalation gate.
 *
 * Returns:
 *  - "revoked" → revocation captured + ack sent; caller MUST skip submit
 *    and the 1b-1 escalation gate.
 *  - "proceed" → continue to the next gate.
 */
export async function runConsentRevocationGate(
  input: RunConsentRevocationGateInput,
): Promise<"revoked" | "proceed"> {
  const { cfg, inboundText, sessionId, deploymentId, organizationId, replySink } = input;

  const resolution = await cfg.governanceConfigResolver(deploymentId);
  if (resolution.status === "missing") return "proceed";

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
          originalText: inboundText,
          details: { event: "gateway_resolver_error_fail_open" },
          auditLevel: "critical",
        });
      } catch (err) {
        console.error("[consent-revocation-gate] verdict persist failure", err);
      }
    } else {
      console.error("[consent-revocation-gate] resolver error; no cached enforce posture");
    }
    return "proceed";
  }

  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return "proceed";

  cfg.postureCache.remember(deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  const entries = cfg.revocationKeywordLoader(resolution.config.jurisdiction as PdpaJurisdiction);
  const matches = scanForRevocationKeywords(inboundText, entries);
  const firstMatch = matches[0];
  if (!firstMatch) return "proceed";

  const contactId = await cfg.sessionContactResolver(sessionId);
  if (!contactId) return "proceed"; // pre-contact inbound

  if (consentConfig.mode === "observe") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cfg.verdictStore.save as any)({
        deploymentId,
        sourceGuard: "consent_gate",
        action: "allow",
        reasonCode: "consent_revoked",
        jurisdiction: resolution.config.jurisdiction,
        clinicType: resolution.config.clinicType,
        conversationId: sessionId,
        decidedAt: cfg.clock().toISOString(),
        originalText: inboundText,
        auditLevel: "warning",
        details: {
          observe: true,
          matchId: firstMatch.entry.id,
          matchedText: firstMatch.matched,
        },
      });
    } catch (err) {
      console.error("[consent-revocation-gate] observe-verdict persist failure", err);
    }
    return "proceed";
  }

  // enforce mode
  await cfg.consentService.recordRevocation({
    contactId,
    source: "inbound_keyword_revocation",
    revokedAt: cfg.clock(),
    actor: "system:inbound_keyword_revocation",
    notes: `keyword=${firstMatch.entry.id}, matched="${firstMatch.matched}"`,
    openConversationSessionId: sessionId,
    organizationId, // from runConsentRevocationGate input — scopes handoff to operator tenant
    deploymentId, // from runConsentRevocationGate input — scopes verdict to deployment
  });

  await replySink.send(REVOCATION_ACK[resolution.config.jurisdiction as PdpaJurisdiction]);
  return "revoked";
}
