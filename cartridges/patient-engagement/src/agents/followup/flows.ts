// ---------------------------------------------------------------------------
// Follow-up Agent — conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../../conversation/types.js";
import { postTreatmentFlow } from "../../conversation/templates/post-treatment.js";

export const FOLLOWUP_FLOWS: ConversationFlowDefinition[] = [postTreatmentFlow];
