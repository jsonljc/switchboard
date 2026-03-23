import { describe, it, expect } from "vitest";
import {
  OperatorChannelSchema,
  CommandStatusSchema,
  GuardrailResultSchema,
  OperatorRequestSchema,
  OperatorCommandSchema,
  LAUNCH_INTENTS,
  TERMINAL_COMMAND_STATUSES,
} from "../operator-command.js";

describe("OperatorCommand schemas", () => {
  describe("OperatorChannelSchema", () => {
    it("accepts valid channels", () => {
      expect(OperatorChannelSchema.parse("telegram")).toBe("telegram");
      expect(OperatorChannelSchema.parse("whatsapp")).toBe("whatsapp");
      expect(OperatorChannelSchema.parse("dashboard")).toBe("dashboard");
    });

    it("rejects invalid channel", () => {
      expect(() => OperatorChannelSchema.parse("email")).toThrow();
    });
  });

  describe("CommandStatusSchema", () => {
    it("accepts all 6 statuses", () => {
      const statuses = ["parsed", "confirmed", "executing", "completed", "failed", "rejected"];
      for (const s of statuses) {
        expect(CommandStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe("TERMINAL_COMMAND_STATUSES", () => {
    it("contains completed, failed, rejected", () => {
      expect(TERMINAL_COMMAND_STATUSES).toContain("completed");
      expect(TERMINAL_COMMAND_STATUSES).toContain("failed");
      expect(TERMINAL_COMMAND_STATUSES).toContain("rejected");
      expect(TERMINAL_COMMAND_STATUSES).not.toContain("parsed");
    });
  });

  describe("LAUNCH_INTENTS", () => {
    it("contains the initial operator intent vocabulary", () => {
      expect(LAUNCH_INTENTS).toContain("follow_up_leads");
      expect(LAUNCH_INTENTS).toContain("pause_campaigns");
      expect(LAUNCH_INTENTS).toContain("show_pipeline");
      expect(LAUNCH_INTENTS).toContain("reassign_leads");
      expect(LAUNCH_INTENTS).toContain("query_lead_history");
    });
  });

  describe("GuardrailResultSchema", () => {
    it("validates a passing guardrail result", () => {
      const result = GuardrailResultSchema.parse({
        canExecute: true,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: [],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: [],
      });
      expect(result.canExecute).toBe(true);
    });

    it("validates a guardrail result with warnings", () => {
      const result = GuardrailResultSchema.parse({
        canExecute: true,
        requiresConfirmation: true,
        requiresPreview: true,
        warnings: ["High budget change"],
        missingEntities: ["campaign_id"],
        riskLevel: "high",
        ambiguityFlags: ["multiple_campaigns_match"],
      });
      expect(result.requiresConfirmation).toBe(true);
      expect(result.riskLevel).toBe("high");
    });
  });

  describe("OperatorRequestSchema", () => {
    it("validates a minimal operator request", () => {
      const request = OperatorRequestSchema.parse({
        id: "req-1",
        organizationId: "org-1",
        operatorId: "op-1",
        channel: "telegram",
        rawInput: "follow up with hot leads",
        receivedAt: new Date(),
      });
      expect(request.channel).toBe("telegram");
    });
  });

  describe("OperatorCommandSchema", () => {
    it("validates a full operator command", () => {
      const command = OperatorCommandSchema.parse({
        id: "cmd-1",
        requestId: "req-1",
        organizationId: "org-1",
        intent: "follow_up_leads",
        entities: [{ type: "lead_segment", filter: { score: { gte: 70 } } }],
        parameters: { urgency: "high" },
        parseConfidence: 0.92,
        guardrailResult: {
          canExecute: true,
          requiresConfirmation: false,
          requiresPreview: false,
          warnings: [],
          missingEntities: [],
          riskLevel: "low",
          ambiguityFlags: [],
        },
        status: "parsed",
        workflowIds: [],
        resultSummary: null,
        createdAt: new Date(),
        completedAt: null,
      });
      expect(command.intent).toBe("follow_up_leads");
      expect(command.parseConfidence).toBeGreaterThan(0.9);
    });

    it("rejects command with missing required fields", () => {
      expect(() =>
        OperatorCommandSchema.parse({ id: "cmd-1", intent: "follow_up_leads" }),
      ).toThrow();
    });
  });
});
