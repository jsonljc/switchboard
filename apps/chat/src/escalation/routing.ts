import type { ChannelAdapter } from "../adapters/adapter.js";
import type { EscalationRule } from "./rules.js";

export async function routeEscalation(
  rule: EscalationRule,
  adapter: ChannelAdapter,
  sourceThreadId: string,
  message: string,
): Promise<void> {
  // If a separate notification channel is configured, send there
  const targetThread = rule.notifyThreadId ?? sourceThreadId;

  await adapter.sendTextReply(targetThread, message);
}
