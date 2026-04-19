import type { SkillTool, ToolExecutionContext } from "../types.js";
import type { AssemblerInput } from "../../handoff/package-assembler.js";
import type { HandoffPackage, HandoffReason, HandoffStore } from "../../handoff/types.js";

interface EscalateToolDeps {
  assembler: { assemble(input: AssemblerInput): HandoffPackage };
  handoffStore: Pick<HandoffStore, "save" | "getBySessionId">;
  notifier: { notify(pkg: HandoffPackage): Promise<void> };
}

interface EscalateInput {
  reason: HandoffReason;
  summary: string;
  customerSentiment?: "positive" | "neutral" | "frustrated" | "angry";
}

export function createEscalateTool(deps: EscalateToolDeps): SkillTool {
  return {
    id: "escalate",
    operations: {
      "handoff.create": {
        description:
          "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        governanceTier: "internal_write" as const,
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
        execute: async (params: unknown, ctx?: ToolExecutionContext) => {
          const input = params as EscalateInput;
          const sessionId = ctx?.sessionId ?? "";
          const orgId = ctx?.orgId ?? "";

          const existing = await deps.handoffStore.getBySessionId(sessionId);
          if (existing && (existing.status === "pending" || existing.status === "assigned")) {
            return { handoffId: existing.id, status: "already_pending" };
          }

          const messages = (ctx?.messages ?? []).map((m) => ({ role: m.role, text: m.content }));

          const pkg = deps.assembler.assemble({
            sessionId,
            organizationId: orgId,
            reason: input.reason,
            leadSnapshot: { channel: "whatsapp" },
            qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
            messages,
          });

          await deps.handoffStore.save(pkg);
          await deps.notifier.notify(pkg);

          return { handoffId: pkg.id, status: "pending" };
        },
      },
    },
  };
}
