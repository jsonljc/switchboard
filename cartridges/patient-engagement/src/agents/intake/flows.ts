// ---------------------------------------------------------------------------
// Intake Agent — conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../../conversation/types.js";
import { qualificationFlow } from "../../conversation/templates/qualification.js";

export const INTAKE_FLOWS: ConversationFlowDefinition[] = [qualificationFlow];
