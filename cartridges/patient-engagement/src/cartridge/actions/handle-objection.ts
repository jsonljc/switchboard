// ---------------------------------------------------------------------------
// Action: patient-engagement.conversation.handle_objection
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { matchObjection } from "../../agents/intake/objection-trees.js";

export async function executeHandleObjection(
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const objectionText = params.objectionText as string;
  const match = matchObjection(objectionText);

  return {
    success: true,
    summary: match
      ? `Matched objection "${match.category}" for patient ${patientId}`
      : `No objection match found for patient ${patientId}`,
    externalRefs: { patientId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: match
      ? { matched: true, category: match.category, response: match.response, followUp: match.followUp }
      : { matched: false, escalate: true },
  };
}
