import type { ResponseContext, GeneratedResponse } from "./composer/response-generator.js";
import { composeUncertainReply, composeWelcomeMessage } from "./composer/reply.js";

/** Minimal skin shape for template fallback. */
interface SkinLike {
  language?: {
    welcomeMessage?: string;
  };
  manifest?: { name?: string };
}

/** Minimal profile shape for template fallback. */
interface ProfileLike {
  profile?: {
    business?: { name?: string };
  };
}

/**
 * Template-based fallback for response generation, used when no LLM ResponseGenerator
 * is configured. Preserves exact behavior per response type.
 */
export function templateFallback(
  context: ResponseContext,
  resolvedSkin: SkinLike | null,
  resolvedProfile: ProfileLike | null,
): GeneratedResponse {
  let text: string;

  switch (context.type) {
    case "welcome":
      text = composeWelcomeMessage(
        resolvedSkin,
        resolvedProfile?.profile?.business?.name ?? undefined,
        context.availableActions,
      );
      break;

    case "uncertain":
      text = composeUncertainReply(context.availableActions);
      break;

    case "clarification":
      text = context.clarificationQuestion ?? composeUncertainReply(context.availableActions);
      break;

    case "denial": {
      const detail = context.denialDetail ?? context.explanation ?? "that action is not allowed";
      text = `I can't do that \u2014 ${lowercaseFirst(detail)}.`;
      break;
    }

    case "result_success":
      text = `All set! ${context.summary ?? "Action completed."}`;
      break;

    case "result_failure":
      text = `Something went wrong: ${lowercaseFirst(context.summary ?? "the action failed")}.`;
      break;

    case "diagnostic":
      text = context.data ?? "No diagnostic data available.";
      break;

    case "read_data":
      text = context.data ?? "No data available.";
      break;

    case "error":
      text = context.errorMessage
        ? `Error: ${context.errorMessage}`
        : "An unexpected error occurred.";
      break;

    default:
      text = "I'm not sure how to respond to that.";
  }

  return { text, usedLLM: false };
}

export function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}

/** WhatsApp compliance: opt-out keywords that must be honored immediately. */
const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);

export function isOptOutKeyword(text: string): boolean {
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

/** Re-subscribe keywords to restore messaging consent. */
const OPT_IN_KEYWORDS = new Set(["start", "subscribe", "unstop"]);

export function isOptInKeyword(text: string): boolean {
  return OPT_IN_KEYWORDS.has(text.trim().toLowerCase());
}
