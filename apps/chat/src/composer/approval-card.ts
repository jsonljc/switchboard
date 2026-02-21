import type { ApprovalCardPayload } from "../adapters/adapter.js";

export function buildApprovalCard(
  summary: string,
  riskCategory: string,
  explanation: string,
  approvalId: string,
  bindingHash: string,
): ApprovalCardPayload {
  return {
    summary: `This action needs your approval:\n\n${summary}`,
    riskCategory,
    explanation: `Risk: ${riskCategory.toUpperCase()}\nReason: ${explanation}`,
    buttons: [
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
      {
        label: "Approve capped at +20%",
        callbackData: JSON.stringify({
          action: "patch",
          approvalId,
          bindingHash,
          patchValue: { maxChangePercent: 20 },
        }),
      },
    ],
  };
}
