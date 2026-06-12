import type { SkillTool } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok } from "../tool-result.js";
import type { AssemblerInput } from "../../handoff/package-assembler.js";
import type { Handoff, HandoffReason, HandoffStore } from "../../handoff/types.js";
import type { SkillRequestContext } from "../types.js";

interface EscalateToolBaseDeps {
  assembler: { assemble(input: AssemblerInput): Handoff };
  handoffStore: Pick<HandoffStore, "save" | "getBySessionId">;
  notifier: { notify(pkg: Handoff): Promise<void> };
}

interface EscalateInput {
  reason: HandoffReason;
  summary: string;
  customerSentiment?: "positive" | "neutral" | "frustrated" | "angry";
}

export type EscalateToolFactory = (ctx: SkillRequestContext) => SkillTool;

export function createEscalateToolFactory(deps: EscalateToolBaseDeps): EscalateToolFactory {
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "escalate",
    operations: {
      "handoff.create": {
        description:
          "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, when the customer is frustrated, or when a medical red flag is present (reason `medical_safety`).",
        effectCategory: "write" as const,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "human_requested",
                "missing_knowledge",
                "complex_objection",
                "negative_sentiment",
                "compliance_concern",
                "medical_safety",
                "booking_failure",
                "max_turns_exceeded",
              ],
            },
            summary: {
              type: "string",
              description: "Brief summary of why escalation is needed and what the customer wants",
            },
            customerSentiment: {
              type: "string",
              enum: ["positive", "neutral", "frustrated", "angry"],
            },
          },
          required: ["reason", "summary"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const input = params as EscalateInput;

          const existing = await deps.handoffStore.getBySessionId(ctx.orgId, ctx.sessionId);
          if (existing && (existing.status === "pending" || existing.status === "assigned")) {
            return ok({ handoffId: existing.id, status: "already_pending" });
          }

          const pkg = deps.assembler.assemble({
            sessionId: ctx.sessionId,
            organizationId: ctx.orgId,
            reason: input.reason,
            leadSnapshot: { channel: "whatsapp" },
            qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
            messages: [],
          });

          await deps.handoffStore.save(pkg);
          await deps.notifier.notify(pkg);

          return ok({ handoffId: pkg.id, status: "pending" });
        },
      },
    },
  });
}
