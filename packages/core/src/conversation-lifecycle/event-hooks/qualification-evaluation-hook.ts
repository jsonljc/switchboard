import type { QualificationSignals } from "@switchboard/schemas";
import type { LifecycleSnapshotStore } from "../types.js";
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";
import type { PlaybookReader } from "../qualification/types.js";
import { resolveTreatmentInterest } from "../qualification/treatment-resolver.js";
import { evaluateQualification } from "../qualification/qualification-rule-evaluator.js";

export interface QualificationEvaluationHookDeps {
  writer: Pick<LifecycleWriter, "recordTransition" | "updateQualificationStatus">;
  snapshotStore: Pick<LifecycleSnapshotStore, "read">;
  playbookReader: PlaybookReader;
  configResolver: Pick<LifecycleConfigResolver, "resolveCapabilities">;
}

export interface SidecarEmittedEvent {
  organizationId: string;
  conversationThreadId: string;
  signals: QualificationSignals;
  /** WorkTrace id of the Alex turn that produced this sidecar (audit pointer). */
  workTraceId: string;
}

export class QualificationEvaluationHook {
  constructor(private readonly deps: QualificationEvaluationHookDeps) {}

  async onSidecarEmitted(event: SidecarEmittedEvent): Promise<void> {
    const capabilities = await this.deps.configResolver.resolveCapabilities(event.organizationId);
    if (!capabilities.has("qualification")) {
      return;
    }

    const snapshot = await this.deps.snapshotStore.read(event.conversationThreadId);
    if (snapshot === null) {
      console.warn(
        `[lifecycle] qualification-evaluation-hook: no snapshot for thread ${event.conversationThreadId}; skipping`,
      );
      return;
    }

    const playbook = await this.deps.playbookReader.readForOrganization(event.organizationId);
    if (playbook === null) {
      console.warn(
        `[lifecycle] qualification-evaluation-hook: no playbook for org ${event.organizationId}; cannot resolve treatment`,
      );
      return;
    }

    const treatment = resolveTreatmentInterest(playbook, event.signals.treatmentInterest);
    const verdict = evaluateQualification(event.signals, treatment);

    if (verdict.verdict === "qualified") {
      await this.deps.writer.recordTransition({
        organizationId: event.organizationId,
        conversationThreadId: event.conversationThreadId,
        contactId: snapshot.contactId,
        toState: "qualified",
        trigger: "qualification_checklist_met",
        actor: "alex",
        evidence: {
          serviceId: verdict.serviceId,
          serviceableMarket: event.signals.serviceableMarket,
          buyingIntent: event.signals.buyingIntent,
          workTraceId: event.workTraceId,
        },
        workTraceId: event.workTraceId,
      });
      return;
    }

    if (verdict.verdict === "disqualifier_candidates_present") {
      await this.deps.writer.updateQualificationStatus({
        organizationId: event.organizationId,
        conversationThreadId: event.conversationThreadId,
        contactId: snapshot.contactId,
        toQualificationStatus: "proposed_disqualified",
        trigger: "system_proposed_disqualification",
        actor: "alex",
        evidence: {
          priorQualificationStatus: snapshot.qualificationStatus,
          candidates: verdict.candidates,
          workTraceId: event.workTraceId,
        },
        workTraceId: event.workTraceId,
      });
      return;
    }

    // verdict.verdict === "unqualified" — silent no-op for v1.
  }
}
