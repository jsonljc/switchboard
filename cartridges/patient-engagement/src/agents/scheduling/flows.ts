// ---------------------------------------------------------------------------
// Scheduling Agent — conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "../../conversation/types.js";
import { bookingFlow } from "../../conversation/templates/booking.js";

export const SCHEDULING_FLOWS: ConversationFlowDefinition[] = [bookingFlow];
