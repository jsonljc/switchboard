import {
  evaluateConsentGate,
  resolveConsentStateConfig,
  type GovernanceVerdictReason,
  type PdpaJurisdiction,
} from "@switchboard/schemas";
import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import { renderHandoffTemplate } from "../../governance/handoff-template.js";
import type { ConsentService } from "../../consent/consent-service.js";
import type { ContactConsentReader } from "../../consent/contact-consent-reader.js";
import { resolveContactJurisdiction } from "../../consent/resolve-contact-jurisdiction.js";
import { ConsentJurisdictionMismatch } from "../../consent/errors.js";
import { DISCLOSURE_COPY } from "../../consent/disclosure-copy.js";
import type { ConversationStatusSetter } from "./deterministic-safety-gate.js";

export interface PdpaConsentGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache;
  consentService: ConsentService;
  contactConsentReader: ContactConsentReader;
  sessionContactResolver: (sessionId: string) => Promise<string | null>;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  clock: () => Date;
}

export class PdpaConsentGateHook implements SkillHook {
  readonly name = "pdpa-consent-gate";

  constructor(private readonly deps: PdpaConsentGateHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const {
      governanceConfigResolver,
      postureCache,
      consentService,
      contactConsentReader,
      sessionContactResolver,
    } = this.deps;

    // 1. Resolve governance config.
    const resolution = await governanceConfigResolver(ctx.deploymentId);
    if (resolution.status === "missing") return;

    if (resolution.status === "error") {
      // Mirror 1b-1 fail-open/fail-closed semantics, scoped to consent-gate posture.
      const cached = postureCache.lastKnown(ctx.deploymentId);
      if (cached?.mode === "enforce") {
        // 1c special-case: do NOT block result.response. Operational only blocks on
        // revoked, which we cannot determine here. Emit critical verdict and proceed.
        await this.saveVerdict({
          reasonCode: "governance_unavailable",
          action: "allow",
          auditLevel: "critical",
          jurisdiction: cached.jurisdiction,
          clinicType: cached.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { event: "resolver_error_fail_open_in_consent_gate" },
          deploymentId: ctx.deploymentId,
        });
      } else {
        console.error("[pdpa-consent-gate] resolver error; fail-open (no cached enforce posture)");
      }
      return;
    }

    const config = resolution.config;
    const consentConfig = resolveConsentStateConfig(config);
    if (consentConfig.mode === "off") return;

    postureCache.remember(ctx.deploymentId, {
      mode: consentConfig.mode,
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
    });

    // 2. Resolve contact (null = pre-contact transient).
    const contactId = await sessionContactResolver(ctx.sessionId);
    if (!contactId) return;

    // 3. Read consent state (org-scoped: never read another tenant's contact). Read
    //    BEFORE stamping so the per-lead jurisdiction — which needs the contact's
    //    phone — drives the stamp and every contact-data decision below.
    const consent = await contactConsentReader.read(ctx.orgId, contactId);

    // 4. Resolve the PER-LEAD jurisdiction: the lead's own market (stamped value, else
    //    their +60/+65 phone) governs how we treat THIS person's PDPA data, falling
    //    back to the org market. One chokepoint so the same contact always resolves the
    //    same way — the stamped value wins, so a re-stamp is a no-op and never a
    //    spurious ConsentJurisdictionMismatch. (config.jurisdiction, the ORG market,
    //    still governs the output-claim gates elsewhere — deliberately unchanged.)
    const leadJurisdiction = resolveContactJurisdiction(
      consent,
      config.jurisdiction as PdpaJurisdiction,
    );

    // 5. Stamp jurisdiction intentionally (NOT via disclosure path).
    try {
      await consentService.attachToGovernedInteraction(contactId, leadJurisdiction, ctx.orgId);
    } catch (err) {
      if (
        err instanceof ConsentJurisdictionMismatch ||
        (err as Error).name === "ConsentJurisdictionMismatch"
      ) {
        console.error("[pdpa-consent-gate] jurisdiction mismatch", err);
        await this.saveVerdict({
          reasonCode: "jurisdiction_mismatch",
          action: "allow",
          auditLevel: "critical",
          jurisdiction: leadJurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: {
            event: "jurisdiction_mismatch",
            stamped: (err as ConsentJurisdictionMismatch).stamped,
            provided: (err as ConsentJurisdictionMismatch).provided,
            contactId,
          },
          deploymentId: ctx.deploymentId,
        });
        return;
      }
      throw err;
    }

    // 6. Evaluate gate (operational class always in 1c; proactive uses separate call site in 1d).
    const decision = evaluateConsentGate({
      contact: {
        pdpaJurisdiction: consent.pdpaJurisdiction,
        consentGrantedAt: consent.consentGrantedAt,
        consentRevokedAt: consent.consentRevokedAt,
      },
      messageClass: "operational",
    });

    if (decision.action === "block") {
      // Defense-in-depth: revoked-race block (gateway scanner should have caught this already).
      // Observe is telemetry-only: record what enforce WOULD have blocked, mutate nothing
      // lead-visible (no response rewrite, no status flip, no handoff).
      if (consentConfig.mode !== "enforce") {
        await this.saveVerdict({
          reasonCode: "consent_revoked",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: leadJurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { event: "defense_in_depth_revoked_race", wouldBlock: true },
          deploymentId: ctx.deploymentId,
        });
        return;
      }
      const originalText = result.response;
      result.response = renderHandoffTemplate({
        jurisdiction: leadJurisdiction,
        reasonCode: "consent_revoked",
      });
      await this.saveVerdict({
        reasonCode: "consent_revoked",
        action: "block",
        auditLevel: "critical",
        jurisdiction: leadJurisdiction,
        clinicType: config.clinicType,
        conversationId: ctx.sessionId,
        originalText,
        emittedText: result.response,
        details: { event: "defense_in_depth_revoked_race" },
        deploymentId: ctx.deploymentId,
      });
      try {
        await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
        await this.deps.handoffStore.save(
          buildHandoffPackage(ctx.sessionId, ctx.orgId, 0, this.deps.clock),
        );
      } catch (e) {
        console.error("[pdpa-consent-gate] block-side persistence failure", e);
      }
      return;
    }

    // 7. Allow path — disclosure detection. Observe-only: never blocks result.response.
    //    Keyed to the per-lead jurisdiction so the recorded disclosure version matches
    //    the stamped jurisdiction (recordDisclosureShown throws on a mismatch).
    const expected = DISCLOSURE_COPY[leadJurisdiction];
    // v1 deterministic heuristic: substring match. Punctuation/whitespace drift will break.
    const includesDisclosure = result.response.includes(expected.text);

    if (consent.aiDisclosureShownAt === null) {
      if (includesDisclosure) {
        try {
          await this.deps.consentService.recordDisclosureShown({
            contactId,
            jurisdiction: leadJurisdiction,
            version: expected.version,
            shownAt: this.deps.clock(),
            actor: "system:skill_runtime",
            organizationId: ctx.orgId,
          });
        } catch (err) {
          // Observe-only disclosure recording must not break the response if a
          // contact is transiently missing for the org (e.g. re-tenanted between
          // the read above and this write).
          console.error("[pdpa-consent-gate] disclosure recording failed", err);
        }
      } else {
        // Mode is observe or enforce here ("off" early-returns above): both persist the
        // disclosure-miss signal so the observe bake sees exactly what enforce would see.
        await this.saveVerdict({
          reasonCode: "disclosure_not_shown",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: leadJurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { expectedVersion: expected.version, sentinelDetected: false },
          deploymentId: ctx.deploymentId,
        });
      }
    } else if (consent.aiDisclosureVersionShown !== expected.version) {
      if (includesDisclosure) {
        try {
          await this.deps.consentService.recordDisclosureShown({
            contactId,
            jurisdiction: leadJurisdiction,
            version: expected.version,
            shownAt: this.deps.clock(),
            actor: "system:skill_runtime",
            organizationId: ctx.orgId,
          });
        } catch (err) {
          // Observe-only disclosure recording must not break the response if a
          // contact is transiently missing for the org (e.g. re-tenanted between
          // the read above and this write).
          console.error("[pdpa-consent-gate] disclosure recording failed", err);
        }
      } else {
        // Same observe+enforce persistence rationale as disclosure_not_shown above.
        await this.saveVerdict({
          reasonCode: "disclosure_version_outdated",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: leadJurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: {
            currentVersion: consent.aiDisclosureVersionShown,
            expectedVersion: expected.version,
            sentinelDetected: false,
          },
          deploymentId: ctx.deploymentId,
        });
      }
    }
  }

  private async saveVerdict(input: {
    reasonCode: GovernanceVerdictReason;
    action: "allow" | "block";
    auditLevel: "info" | "warning" | "critical";
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
    conversationId: string;
    originalText?: string;
    emittedText?: string;
    details: Record<string, unknown>;
    deploymentId: string;
  }) {
    try {
      await this.deps.verdictStore.save({
        deploymentId: input.deploymentId,
        sourceGuard: "consent_gate",
        action: input.action,
        reasonCode: input.reasonCode,
        jurisdiction: input.jurisdiction,
        clinicType: input.clinicType,
        originalText: input.originalText,
        emittedText: input.emittedText,
        auditLevel: input.auditLevel,
        decidedAt: this.deps.clock().toISOString(),
        conversationId: input.conversationId,
        details: input.details,
      });
    } catch (err) {
      console.error("[pdpa-consent-gate] verdict persistence failure", err);
    }
  }
}
