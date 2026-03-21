// ---------------------------------------------------------------------------
// messaging — Multi-channel messaging cartridge
// ---------------------------------------------------------------------------

export { MESSAGING_MANIFEST, MESSAGING_ACTIONS } from "./manifest.js";
export { DEFAULT_MESSAGING_GUARDRAILS } from "./defaults/guardrails.js";
export { DEFAULT_MESSAGING_POLICIES } from "./defaults/policies.js";
export { WhatsAppRateLimiter, type RateLimiterConfig } from "./rate-limiter.js";
export { detectOptOut, detectOptIn, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from "./opt-out.js";
export {
  EscalationRouter,
  type EscalationMessage,
  type EscalationRouterConfig,
  type OwnerReply,
} from "./escalation-router.js";
