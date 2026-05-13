import type { ActionEnvelope, ApprovalRequest, DecisionTrace } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ApprovalState } from "../approval/state-machine.js";

export interface ProposeResult {
  envelope: ActionEnvelope;
  decisionTrace: DecisionTrace;
  approvalRequest: ApprovalRequest | null;
  denied: boolean;
  explanation: string;
  /** Set when observe mode or emergency override auto-approved the action. */
  governanceNote?: string;
}

export interface ApprovalResponse {
  envelope: ActionEnvelope;
  approvalState: ApprovalState;
  executionResult: ExecuteResult | null;
}
