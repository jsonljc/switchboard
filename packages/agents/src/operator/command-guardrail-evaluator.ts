import type { GuardrailResult, RiskLevel } from "@switchboard/schemas";
import { READ_ONLY_INTENTS } from "./operator-types.js";
import type { InterpretResult } from "./operator-types.js";

const MIN_CONFIDENCE_THRESHOLD = 0.5;

const WRITE_INTENTS_REQUIRING_ENTITIES: Record<string, string[]> = {
  pause_campaigns: ["campaign"],
  resume_campaigns: ["campaign"],
  reassign_leads: ["lead_segment"],
  draft_campaign: ["product"],
};

const HIGH_RISK_INTENTS = new Set(["pause_campaigns", "resume_campaigns"]);

export class CommandGuardrailEvaluator {
  evaluate(input: InterpretResult): GuardrailResult {
    const warnings: string[] = [];
    const missingEntities: string[] = [];
    let canExecute = true;
    let requiresConfirmation = false;
    let requiresPreview = false;
    let riskLevel: RiskLevel = "low";

    // Unknown intent — cannot execute
    if (input.intent === "unknown") {
      return {
        canExecute: false,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings: ["Could not understand the command"],
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: input.ambiguityFlags,
      };
    }

    // Low confidence — block execution
    if (input.confidence < MIN_CONFIDENCE_THRESHOLD) {
      canExecute = false;
      warnings.push(`Low confidence (${(input.confidence * 100).toFixed(0)}%) — please rephrase`);
    }

    // Ambiguity flags from LLM
    if (input.ambiguityFlags.length > 0) {
      warnings.push(`Ambiguous input: ${input.ambiguityFlags.join(", ")}`);
    }

    // Read-only intents are low-risk, no confirmation needed
    if (READ_ONLY_INTENTS.has(input.intent)) {
      return {
        canExecute,
        requiresConfirmation: false,
        requiresPreview: false,
        warnings,
        missingEntities: [],
        riskLevel: "low",
        ambiguityFlags: input.ambiguityFlags,
      };
    }

    // Write intents require confirmation
    requiresConfirmation = true;
    riskLevel = "medium";

    // High-risk intents require preview
    if (HIGH_RISK_INTENTS.has(input.intent)) {
      requiresPreview = true;
    }

    // Check for missing required entities
    const requiredTypes = WRITE_INTENTS_REQUIRING_ENTITIES[input.intent];
    if (requiredTypes) {
      for (const requiredType of requiredTypes) {
        const found = input.entities.some((e) => e.type === requiredType);
        if (!found) {
          missingEntities.push(requiredType);
        }
      }
      if (missingEntities.length > 0) {
        warnings.push(`Missing context: ${missingEntities.join(", ")}`);
      }
    }

    // Broad scope detection (filter without specific ID = potentially many targets)
    const hasBroadScope = input.entities.some((e) => !e.id && e.filter);
    if (hasBroadScope && HIGH_RISK_INTENTS.has(input.intent)) {
      riskLevel = "high";
      requiresPreview = true;
      warnings.push("Command targets multiple items — preview recommended");
    }

    return {
      canExecute,
      requiresConfirmation,
      requiresPreview,
      warnings,
      missingEntities,
      riskLevel,
      ambiguityFlags: input.ambiguityFlags,
    };
  }
}
