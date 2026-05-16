import type { ConsentSource, PdpaJurisdiction } from "@switchboard/schemas";
import type { GovernanceVerdictStore } from "../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../handoff/types.js";
import type { ConversationStatusSetter } from "../skill-runtime/hooks/deterministic-safety-gate.js";
import { buildHandoffPackage } from "../handoff/build-handoff-package.js";
import type { ConsentStateStore } from "./consent-store.js";
import {
  ConsentJurisdictionMismatch,
  ConsentNotesRequired,
  ConsentRevokedCannotRegrant,
  ConsentSystemActorRejected,
  ContactNotFound,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ConsentService {
  attachToGovernedInteraction(contactId: string, jurisdiction: PdpaJurisdiction): Promise<void>;

  recordDisclosureShown(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    version: string;
    shownAt: Date;
    actor: string;
  }): Promise<void>;

  recordGrant(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    source: Extract<
      ConsentSource,
      "whatsapp_quick_reply" | "ig_dm_reply" | "web_form" | "operator_recorded"
    >;
    grantedAt: Date;
    actor: string;
    notes?: string;
    // Per-call overrides for verdict context. Defaults to constructor-bound values.
    organizationId?: string;
    deploymentId?: string;
  }): Promise<void>;

  recordRevocation(input: {
    contactId: string;
    source: Extract<ConsentSource, "inbound_keyword_revocation" | "operator_recorded_revocation">;
    revokedAt: Date;
    actor: string;
    notes?: string;
    openConversationSessionId?: string;
    // Per-call overrides for verdict context. Defaults to constructor-bound values.
    organizationId?: string;
    deploymentId?: string;
  }): Promise<void>;

  clearConsent(input: {
    contactId: string;
    actor: string;
    notes: string;
    // Per-call overrides for verdict context. Defaults to constructor-bound values.
    organizationId?: string;
    deploymentId?: string;
  }): Promise<void>;
}

export interface ConsentServiceDeps {
  store: ConsentStateStore;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  clock: () => Date;
  deploymentId: string;
  orgId: string;
  clinicType: "medical" | "nonMedical";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createConsentService(deps: ConsentServiceDeps): ConsentService {
  const {
    store,
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
    deploymentId,
    orgId,
    clinicType,
  } = deps;

  // Internal helper. Stamps jurisdiction or throws ConsentJurisdictionMismatch.
  // Does NOT throw ContactNotFound when current is null — setJurisdictionIfNull
  // is a safe SQL-level no-op for nonexistent contacts (updateMany WHERE id=X AND
  // pdpaJurisdiction IS NULL updates 0 rows). Individual methods do their own
  // ContactNotFound checks where meaningful.
  async function ensureJurisdictionStamped(
    contactId: string,
    jurisdiction: PdpaJurisdiction,
  ): Promise<{ wasNewlyStamped: boolean }> {
    const current = await store.readOrNull(contactId);
    if (current?.pdpaJurisdiction === jurisdiction) return { wasNewlyStamped: false };
    if (current?.pdpaJurisdiction != null) {
      throw new ConsentJurisdictionMismatch({
        contactId,
        stamped: current.pdpaJurisdiction,
        provided: jurisdiction,
      });
    }
    await store.setJurisdictionIfNull(contactId, jurisdiction);
    return { wasNewlyStamped: true };
  }

  async function persistVerdict(input: {
    reasonCode: string;
    auditLevel: "info" | "warning" | "critical";
    action: "allow" | "block" | "escalate";
    jurisdiction: PdpaJurisdiction;
    conversationId: string;
    details: Record<string, unknown>;
    // Per-call override — defaults to constructor-bound deploymentId.
    deploymentId?: string;
  }) {
    const effectiveDeploymentId = input.deploymentId ?? deploymentId;
    try {
      // Cast needed: GovernanceVerdictDetails is narrower than our custom details shapes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (verdictStore.save as any)({
        deploymentId: effectiveDeploymentId,
        sourceGuard: "consent_gate",
        action: input.action,
        reasonCode: input.reasonCode,
        auditLevel: input.auditLevel,
        jurisdiction: input.jurisdiction,
        clinicType,
        conversationId: input.conversationId,
        decidedAt: clock().toISOString(),
        details: input.details,
      });
    } catch (err) {
      // Emission integrity > persistence completeness — mirror 1b-1/1b-2.
      console.error("[consent-service] verdict persistence failure", err);
    }
  }

  return {
    async attachToGovernedInteraction(contactId, jurisdiction) {
      const result = await ensureJurisdictionStamped(contactId, jurisdiction);
      if (result.wasNewlyStamped) {
        await persistVerdict({
          reasonCode: "allowed",
          auditLevel: "info",
          action: "allow",
          jurisdiction,
          conversationId: contactId, // contact-scoped event; no session here
          details: { event: "jurisdiction_stamped", jurisdiction },
        });
      }
    },

    async recordDisclosureShown({ contactId, jurisdiction, version, shownAt, actor }) {
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });
      if (current.pdpaJurisdiction && current.pdpaJurisdiction !== jurisdiction) {
        throw new ConsentJurisdictionMismatch({
          contactId,
          stamped: current.pdpaJurisdiction,
          provided: jurisdiction,
        });
      }
      // Idempotent same-version no-op.
      if (current.aiDisclosureVersionShown === version) return;

      const previousVersion = current.aiDisclosureVersionShown;
      await store.setDisclosure({ contactId, version, shownAt, actor });

      await persistVerdict({
        reasonCode: "allowed",
        auditLevel: "info",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        details: previousVersion
          ? { event: "disclosure_version_bumped", previousVersion, newVersion: version }
          : { event: "disclosure_shown", version, jurisdiction },
      });
    },

    async recordGrant({
      contactId,
      jurisdiction,
      source,
      grantedAt,
      actor,
      notes,
      organizationId: _organizationId,
      deploymentId: deploymentIdOverride,
    }) {
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });
      if (current.consentRevokedAt) {
        throw new ConsentRevokedCannotRegrant({
          contactId,
          revokedAt: new Date(current.consentRevokedAt),
        });
      }
      await ensureJurisdictionStamped(contactId, jurisdiction);
      await store.setGrant({ contactId, grantedAt, source, actor, notes });
      await persistVerdict({
        reasonCode: "allowed",
        auditLevel: "info",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        deploymentId: deploymentIdOverride,
        details: { event: "consent_granted", source, jurisdiction },
      });
    },

    async recordRevocation({
      contactId,
      source,
      revokedAt,
      actor,
      notes,
      openConversationSessionId,
      organizationId: organizationIdOverride,
      deploymentId: deploymentIdOverride,
    }) {
      const effectiveOrgId = organizationIdOverride ?? orgId;
      const effectiveDeploymentId = deploymentIdOverride ?? deploymentId;

      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });

      // Infer jurisdiction: prefer stamped; fall back to "SG" for verdict shape only
      // (never surfaces to Contact). Gateway + admin always stamp jurisdiction upstream.
      const jurisdiction = (current.pdpaJurisdiction ?? "SG") as PdpaJurisdiction;

      const { wasNewlyRevoked } = await store.setRevocationIfNotRevoked({
        contactId,
        revokedAt,
        source,
        actor,
        notes,
      });

      if (!wasNewlyRevoked) return; // idempotent

      // Option (b): annotation deferred to Phase 2. Flip status + save new handoff.
      const handoffAnnotated = false;

      if (openConversationSessionId) {
        try {
          await conversationStore.setConversationStatus(
            openConversationSessionId,
            "human_override",
          );
          await handoffStore.save(
            buildHandoffPackage(openConversationSessionId, effectiveOrgId, 0, clock),
          );
        } catch (err) {
          console.error("[consent-service] handoff or status flip failure", err);
        }
      }

      await persistVerdict({
        reasonCode: "consent_revoked",
        auditLevel: "critical",
        action: "block",
        jurisdiction,
        conversationId: openConversationSessionId ?? contactId,
        deploymentId: effectiveDeploymentId,
        details: {
          event: "consent_revoked",
          source,
          sessionId: openConversationSessionId ?? null,
          handoffAnnotated,
        },
      });
    },

    async clearConsent({
      contactId,
      actor,
      notes,
      organizationId: _organizationId,
      deploymentId: deploymentIdOverride,
    }) {
      if (!notes || notes.trim().length === 0) {
        throw new ConsentNotesRequired();
      }
      if (actor.startsWith("system:")) {
        throw new ConsentSystemActorRejected({ actor });
      }
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });

      const { previousGrantedAt, previousRevokedAt } = await store.clearConsentTimestamps({
        contactId,
        actor,
        notes,
      });

      const jurisdiction = (current.pdpaJurisdiction ?? "SG") as PdpaJurisdiction;
      await persistVerdict({
        reasonCode: "consent_cycle_reset",
        auditLevel: "warning",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        deploymentId: deploymentIdOverride,
        details: {
          event: "consent_cleared",
          previousGrantedAt: previousGrantedAt ? previousGrantedAt.toISOString() : null,
          previousRevokedAt: previousRevokedAt ? previousRevokedAt.toISOString() : null,
          actor,
          notes,
        },
      });
    },
  };
}
