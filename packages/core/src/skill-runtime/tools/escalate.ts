import type { SkillTool } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok } from "../tool-result.js";
import type { AssemblerInput } from "../../handoff/package-assembler.js";
import type { HandoffPackage, HandoffReason, HandoffStore } from "../../handoff/types.js";

interface EscalateToolDeps {
  assembler: { assemble(input: AssemblerInput): HandoffPackage };
  handoffStore: Pick<HandoffStore, "save" | "getBySessionId">;
  notifier: { notify(pkg: HandoffPackage): Promise<void> };
  sessionId: string;
  orgId: string;
  messages: Array<{ role: string; content: string }>;
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
          const sessionId = deps.sessionId;
          const orgId = deps.orgId;

          const existing = await deps.handoffStore.getBySessionId(sessionId);
          if (existing && (existing.status === "pending" || existing.status === "assigned")) {
            return ok({ handoffId: existing.id, status: "already_pending" });
          }

          const messages = deps.messages.map((m: { role: string; content: string }) => ({
            role: m.role,
            text: m.content,
          }));

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

          return ok({ handoffId: pkg.id, status: "pending" });
        },
      },
    },
  };
}
