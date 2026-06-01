import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { FOLLOW_UP_DELAY_MS } from "@switchboard/schemas";
import type { FollowUpReason, FollowUpDelay } from "@switchboard/schemas";
import type { CreateScheduledFollowUpInput } from "../../scheduled-follow-up/scheduled-follow-up-store.js";

interface ScheduleFollowUpDeps {
  followUpStore: {
    create(input: CreateScheduledFollowUpInput): Promise<{ id: string }>;
    findPendingForContact(orgId: string, contactId: string): Promise<{ id: string } | null>;
  };
  /** Injectable clock for deterministic dueAt; defaults to wall clock. */
  now?: () => Date;
}

interface ScheduleFollowUpInput {
  reason: FollowUpReason;
  delay: FollowUpDelay;
  note?: string;
}

export type ScheduleFollowUpToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Lets Alex schedule a single re-engagement follow-up for the CURRENT contact.
 * Trust-bound ids (orgId, contactId, sessionId, deploymentId, workUnitId) come
 * from the injected SkillRequestContext, NEVER from LLM input (AI-1). The tool
 * only RECORDS intent — the governed send happens later via the firing cron +
 * conversation.followup.send handler.
 */
export function createScheduleFollowUpToolFactory(
  deps: ScheduleFollowUpDeps,
): ScheduleFollowUpToolFactory {
  const now = deps.now ?? (() => new Date());
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "follow-up",
    operations: {
      "followup.schedule": {
        description:
          "Schedule a single WhatsApp re-engagement follow-up for this lead, to be " +
          "sent automatically later (only if consent, the messaging window, and an " +
          "approved template all allow). Use when a qualified lead has gone quiet or " +
          "hesitant. Do not schedule more than one follow-up per conversation.",
        effectCategory: "write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "hesitation",
                "price_concern",
                "timing_not_now",
                "awaiting_info",
                "went_quiet",
              ],
            },
            delay: {
              type: "string",
              enum: ["in_1_day", "in_3_days", "in_1_week"],
            },
            note: {
              type: "string",
              description: "Optional short context for the team (not sent to the customer).",
            },
          },
          required: ["reason", "delay"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const contactId = ctx.contactId;
          if (!contactId) {
            return fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
              modelRemediation:
                "Do not schedule a follow-up without an active contact. Continue the conversation or escalate.",
              retryable: false,
            });
          }

          const input = params as ScheduleFollowUpInput;
          const dueAt = new Date(now().getTime() + FOLLOW_UP_DELAY_MS[input.delay]);
          const dayBucket = dueAt.toISOString().slice(0, 10);
          const dedupeKey = `followup:${ctx.orgId}:${contactId}:${dayBucket}`;

          const existing = await deps.followUpStore.findPendingForContact(ctx.orgId, contactId);
          if (existing) {
            return ok({ followUpId: existing.id, status: "already_scheduled" });
          }

          const created = await deps.followUpStore.create({
            organizationId: ctx.orgId,
            contactId,
            conversationThreadId: ctx.sessionId,
            sessionId: ctx.sessionId,
            deploymentId: ctx.deploymentId,
            workUnitId: ctx.workUnitId ?? null,
            channel: "whatsapp",
            jurisdiction: null,
            reason: input.reason,
            note: input.note ?? null,
            templateIntentClass: "re-engagement-offer",
            dueAt,
            dedupeKey,
          });

          return ok({
            followUpId: created.id,
            scheduledFor: dueAt.toISOString(),
            status: "scheduled",
          });
        },
      },
    },
  });
}
