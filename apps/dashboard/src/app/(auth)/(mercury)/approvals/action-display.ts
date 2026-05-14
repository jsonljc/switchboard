const MAP: Record<string, string> = {
  "billing.refund.issue": "refund",
  "billing.discount.apply": "discount",
  "billing.fee.apply": "fee",
  "billing.voucher.issue": "voucher",
  "comms.sms.broadcast": "SMS broadcast",
  "calendar.reschedule.bulk": "bulk reschedule",
  "catalog.price.update": "price update",
  "ads.budget.scale": "ad budget change",
  "infra.db.rotate-credentials": "credential rotation",
  "data.session.purge": "data purge",
  "cms.consent.publish": "consent form update",
  "compliance.gdpr.export": "data export",
};

/**
 * Maps an internal action id to a customer-facing display label.
 * Unknown ids fall back to a tidied dotted-id (dots → spaces).
 */
export function actionDisplay(actionId: string | undefined | null): string {
  if (!actionId) return "action";
  return MAP[actionId] ?? actionId.replace(/\./g, " ");
}
