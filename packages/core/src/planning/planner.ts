import { randomUUID } from "node:crypto";
import type { GoalBrief, DataFlowPlan, CapabilityDescriptor, StepType } from "@switchboard/schemas";
import type { PlanTemplate, PlanningContext } from "./types.js";
import { PLAN_TEMPLATES } from "./templates.js";

/**
 * PlanGraphBuilder — converts a GoalBrief into a DataFlowPlan using templates.
 *
 * Template-based (not LLM). Selects an appropriate plan template based on
 * goal type, resolves binding expressions, and produces a DataFlowPlan
 * compatible with the existing DataFlowExecutor.
 */
export class PlanGraphBuilder {
  private templates: Map<string, PlanTemplate>;

  constructor(customTemplates?: Record<string, PlanTemplate>) {
    this.templates = new Map<string, PlanTemplate>();

    // Load built-in templates
    for (const [key, template] of Object.entries(PLAN_TEMPLATES)) {
      this.templates.set(key, template);
    }

    // Add custom templates (can override built-in)
    if (customTemplates) {
      for (const [key, template] of Object.entries(customTemplates)) {
        this.templates.set(key, template);
      }
    }
  }

  /**
   * Build a DataFlowPlan from a GoalBrief.
   * Returns null if no template matches the goal type.
   */
  buildPlan(
    goal: GoalBrief,
    capabilities: CapabilityDescriptor[],
    context: PlanningContext,
  ): DataFlowPlan | null {
    // Find matching template
    const template = this.findTemplate(goal.type);
    if (!template) return null;

    const planId = `plan_${randomUUID()}`;
    const envelopeId = `env_${randomUUID()}`;

    // Build steps from template
    const steps = template.steps
      .map((stepTemplate, index) => {
        // Resolve action pattern
        const actionType = this.resolveActionPattern(
          stepTemplate.actionPattern,
          goal,
          capabilities,
        );

        // Skip system.log steps if no matching capability
        if (actionType === "system.log") {
          return null;
        }

        // Resolve parameter templates
        const parameters = this.resolveParameterTemplate(
          stepTemplate.parameterTemplate,
          goal,
          context,
          index,
        );

        // Resolve condition
        const condition = stepTemplate.condition
          ? this.resolveConditionTemplate(stepTemplate.condition, goal)
          : null;

        return {
          index,
          cartridgeId: context.cartridgeId,
          actionType,
          parameters,
          condition,
          stepType: stepTemplate.stepType as StepType,
        };
      })
      .filter((step): step is NonNullable<typeof step> => step !== null)
      // Re-index after filtering
      .map((step, i) => ({ ...step, index: i }));

    if (steps.length === 0) return null;

    return {
      id: planId,
      envelopeId,
      strategy: template.strategy,
      approvalMode: template.approvalMode,
      summary: `${template.name}: ${goal.objective}`,
      steps,
      deferredBindings: true,
    };
  }

  /**
   * Register a custom plan template.
   */
  registerTemplate(template: PlanTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Find the best template for a goal type.
   */
  private findTemplate(goalType: string): PlanTemplate | null {
    // Direct match by goal type
    for (const template of this.templates.values()) {
      if (template.goalTypes.includes(goalType)) {
        return template;
      }
    }
    return null;
  }

  /**
   * Resolve an action pattern to an actual action type.
   */
  private resolveActionPattern(
    pattern: string,
    goal: GoalBrief,
    capabilities: CapabilityDescriptor[],
  ): string {
    // Direct reference to goal slot
    if (pattern.startsWith("$goal.")) {
      const path = pattern.slice("$goal.".length);
      const value = getNestedValue(goal, path);
      return typeof value === "string" ? value : pattern;
    }

    // Check if the pattern exists in capabilities
    const capability = capabilities.find((c) => c.actionType === pattern);
    if (capability) return capability.actionType;

    // Return as-is (may be a system action)
    return pattern;
  }

  /**
   * Resolve parameter template with goal context.
   * $goal references are resolved at build time; $step/$prev at execution time.
   */
  private resolveParameterTemplate(
    template: Record<string, unknown>,
    goal: GoalBrief,
    context: PlanningContext,
    _stepIndex: number,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(template)) {
      if (key === "_passthrough" && typeof value === "string" && value.startsWith("$goal.")) {
        // Special: spread goal slots into parameters
        const path = value.slice("$goal.".length);
        const slotValue = getNestedValue(goal, path);
        if (slotValue && typeof slotValue === "object") {
          Object.assign(resolved, slotValue);
        }
        continue;
      }

      resolved[key] = this.resolveValue(value, goal, context);
    }

    return resolved;
  }

  /**
   * Resolve a single value, replacing $goal references.
   * $step and $prev references are left for the DataFlowExecutor.
   */
  private resolveValue(
    value: unknown,
    goal: GoalBrief,
    context: PlanningContext,
  ): unknown {
    if (typeof value !== "string") return value;

    // $goal references → resolve now
    if (value.startsWith("$goal.")) {
      const path = value.slice("$goal.".length);

      // Special: entityRefs.adAccount defaults to context
      if (path === "entityRefs.adAccount") {
        return goal.entityRefs?.["adAccount"] ?? context.adAccountId ?? "";
      }

      const resolved = getNestedValue(goal, path);
      return resolved ?? value;
    }

    // $step/$prev references → leave for DataFlowExecutor
    if (value.startsWith("$step[") || value.startsWith("$prev.")) {
      return value;
    }

    return value;
  }

  /**
   * Resolve a condition template string.
   */
  private resolveConditionTemplate(
    condition: string,
    goal: GoalBrief,
  ): string {
    // Replace $goal references in conditions
    return condition.replace(/\$goal\.[a-zA-Z0-9_.\[\]]+/g, (match) => {
      const path = match.slice("$goal.".length);
      const value = getNestedValue(goal, path);
      if (value === undefined) return match;
      return typeof value === "string" ? `"${value}"` : String(value);
    });
  }
}

/**
 * Navigate a nested object by dot-separated path.
 * Supports array indexing: "constraints[0].value"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // Handle array indexing: "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1]!;
      const index = parseInt(arrayMatch[2]!, 10);
      if (typeof current !== "object") return undefined;
      const arr = (current as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) return undefined;
      current = arr[index];
    } else {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}
