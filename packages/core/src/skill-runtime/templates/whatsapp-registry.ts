import type { IntentClass, TemplateCategory } from "@switchboard/schemas";

export type Jurisdiction = "SG" | "MY";

/**
 * Where each template sits in the Meta App Review lifecycle.
 *
 * - "draft"     — authored in-repo, not yet submitted to Meta. Visible to the gate but never substituted.
 * - "submitted" — submitted to Meta, awaiting review. Visible to the gate but never substituted.
 * - "approved"  — Meta approved this template under metaTemplateName. Only status that can substitute in enforce mode.
 *
 * In enforce mode, the gate substitutes only entries with `approvalStatus === "approved"`.
 * Draft / submitted entries fall through to block + handoff with sub-cause "template_not_approved".
 */
export type TemplateApprovalStatus = "draft" | "submitted" | "approved";

/**
 * A WhatsApp template entry in the in-repo registry. Used by the Phase 1d window-gate hook
 * to substitute outbound free-form responses when the conversation is outside the 24h
 * customer-service window.
 *
 * Each body must pass the 1b-1 banned-phrase scanner AND the 1b-2 claim classifier — see
 * whatsapp-registry.test.ts for the cross-phase regression test (Task 5). The `approvalStatus`
 * field determines whether the runtime may actually substitute this entry; only Meta-approved
 * entries (`approvalStatus === "approved"`) are eligible.
 */
export interface WhatsAppTemplate {
  /** Internal name; also used in audit logs and tests. */
  name: string;
  /** The template name as submitted to Meta. */
  metaTemplateName: string;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
  /** Meta-defined category. Propagated into substitute verdicts for downstream Phase 2 pricing. */
  templateCategory: TemplateCategory;
  /** Meta approval lifecycle. Only "approved" can substitute in enforce mode. */
  approvalStatus: TemplateApprovalStatus;
  /** Rendered body used for substitution. */
  body: string;
  /** Variable placeholders, in Meta order. */
  variables: ReadonlyArray<{ name: string; description: string }>;
}

export const WHATSAPP_TEMPLATES: ReadonlyArray<WhatsAppTemplate> = [
  // 10 entries (5 intent classes × 2 jurisdictions). Body authoring + Meta submission
  // happen in Task 5. Stubs here so the structural tests pass.
  {
    name: "appointment_confirm_sg_v1",
    metaTemplateName: "alex_appointment_confirm_sg_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_confirm_my_v1",
    metaTemplateName: "alex_appointment_confirm_my_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_reminder_sg_v1",
    metaTemplateName: "alex_appointment_reminder_sg_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_reminder_my_v1",
    metaTemplateName: "alex_appointment_reminder_my_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "aftercare_checkin_sg_v1",
    metaTemplateName: "alex_aftercare_checkin_sg_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "aftercare_checkin_my_v1",
    metaTemplateName: "alex_aftercare_checkin_my_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "consult_followup_sg_v1",
    metaTemplateName: "alex_consult_followup_sg_v1",
    intentClass: "consult-followup",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "consult_followup_my_v1",
    metaTemplateName: "alex_consult_followup_my_v1",
    intentClass: "consult-followup",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "re_engagement_offer_sg_v1",
    metaTemplateName: "alex_re_engagement_offer_sg_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "SG",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "re_engagement_offer_my_v1",
    metaTemplateName: "alex_re_engagement_offer_my_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "MY",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
];

export function selectTemplate(args: {
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
}): WhatsAppTemplate | null {
  return (
    WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === args.intentClass && t.jurisdiction === args.jurisdiction,
    ) ?? null
  );
}
