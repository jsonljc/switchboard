import type { ApprovalCardPayload } from "../adapters/adapter.js";

export function buildApprovalCard(
  summary: string,
  riskCategory: string,
  explanation: string,
  approvalId: string,
  bindingHash: string,
  actionType?: string,
): ApprovalCardPayload {
  const buttons: ApprovalCardPayload["buttons"] = [
    {
      label: "Approve",
      callbackData: JSON.stringify({
        action: "approve",
        approvalId,
        bindingHash,
      }),
    },
    {
      label: "Reject",
      callbackData: JSON.stringify({
        action: "reject",
        approvalId,
      }),
    },
  ];

  // Only show the patch button for budget adjustment actions
  if (actionType && actionType.includes("adjust_budget")) {
    buttons.push({
      label: "Approve capped at +20%",
      callbackData: JSON.stringify({
        action: "patch",
        approvalId,
        bindingHash,
        patchValue: { maxChangePercent: 20 },
      }),
    });
  }

  return {
    summary: `This action needs your approval:\n\n${summary}`,
    riskCategory,
    explanation: `Risk: ${riskCategory.toUpperCase()}\nReason: ${explanation}`,
    buttons,
  };
}
