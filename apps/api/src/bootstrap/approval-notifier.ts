import type { ApprovalNotifier } from "@switchboard/core/notifications";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";

export interface ParkedApprovalNotifierEnv {
  slackBotToken: string | undefined;
  slackApprovalChannel: string | undefined;
}

/**
 * Builds the best-effort notifier PlatformIngress fires when a submission parks
 * as a gated lifecycle (spec: 2026-06-05-slack-approval-notifications-design.md
 * section 5). Env-gated pilot posture: one Slack conversation for all parked
 * approvals. SLACK_BOT_TOKEN must be the bot token of the SAME Slack app as the
 * org's managed Slack channel, or button taps are delivered to the wrong app's
 * interactivity URL and never reach the managed webhook. Multi-tenant org-scoped
 * delivery is the named follow-up; this builder is where it would plug in.
 */
export function buildParkedApprovalNotifier(
  env: ParkedApprovalNotifierEnv,
  logger: { info(msg: string): void },
): ApprovalNotifier | undefined {
  if (!env.slackBotToken || !env.slackApprovalChannel) {
    logger.info(
      "Approval notifications: off (set SLACK_BOT_TOKEN and SLACK_APPROVAL_CHANNEL to put parked approvals in front of operators in Slack)",
    );
    return undefined;
  }
  logger.info(
    "Approval notifications: Slack enabled for parked approvals. Ensure this bot token belongs to the same Slack app whose interactivity URL routes to the managed webhook, or button taps will never arrive.",
  );
  return new SlackApprovalNotifier(env.slackBotToken, {
    defaultConversationId: env.slackApprovalChannel,
  });
}
