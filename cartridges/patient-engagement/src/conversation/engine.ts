// ---------------------------------------------------------------------------
// Conversation Flow Engine — Deterministic execution
// ---------------------------------------------------------------------------

import type {
  ConversationFlowDefinition,
  ConversationState,
  FlowStep,
  BranchCondition,
} from "./types.js";

/**
 * Create a new conversation state for a flow.
 */
export function createConversationState(
  flow: ConversationFlowDefinition,
  variables: Record<string, unknown> = {},
): ConversationState {
  return {
    flowId: flow.id,
    currentStepIndex: 0,
    variables,
    completed: false,
    escalated: false,
    history: [],
  };
}

/**
 * Execute the next step in a conversation flow.
 * Returns the output message and updated state.
 */
export function executeNextStep(
  flow: ConversationFlowDefinition,
  state: ConversationState,
): {
  output: string;
  state: ConversationState;
  actionRequired?: { actionType: string; parameters: Record<string, unknown> };
} {
  if (state.completed || state.escalated) {
    return { output: "", state };
  }

  if (state.currentStepIndex >= flow.steps.length) {
    return {
      output: "",
      state: { ...state, completed: true },
    };
  }

  const step = flow.steps[state.currentStepIndex]!;
  const newState = { ...state, history: [...state.history] };

  switch (step.type) {
    case "message": {
      const output = interpolate(step.template ?? "", newState.variables);
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return { output, state: newState };
    }

    case "question": {
      let output = interpolate(step.template ?? "", newState.variables);
      const optionsText = (step.options ?? []).map((opt, i) => `${i + 1}. ${opt}`).join("\n");
      // When llmPersonalization is true, personalize the template with context
      if (step.llmPersonalization && newState.variables["patientName"]) {
        output = output.replace(/\bpatient\b/gi, String(newState.variables["patientName"]));
      }
      const fullOutput = `${output}\n${optionsText}`;
      newState.history.push({ stepId: step.id, output: fullOutput, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return { output: fullOutput, state: newState };
    }

    case "branch": {
      const targetIndex = evaluateBranches(flow, step.branches ?? [], newState.variables);
      newState.currentStepIndex = targetIndex;
      // Recurse to execute the branch target
      return executeNextStep(flow, newState);
    }

    case "wait": {
      const output = `[Waiting ${(step.waitMs ?? 0) / 1000} seconds]`;
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return { output, state: newState };
    }

    case "action": {
      const output = interpolate(step.template ?? "Executing action...", newState.variables);
      const parameters = interpolateParams(step.actionParameters ?? {}, newState.variables);
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return {
        output,
        state: newState,
        actionRequired: step.actionType ? { actionType: step.actionType, parameters } : undefined,
      };
    }

    case "escalate": {
      const output = interpolate(
        step.template ?? "Transferring you to a team member.",
        newState.variables,
      );
      newState.escalated = true;
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      return { output, state: newState };
    }

    case "score": {
      const output = interpolate(step.template ?? "Evaluating...", newState.variables);
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return { output, state: newState };
    }

    case "objection": {
      const output = interpolate(step.template ?? "", newState.variables);
      newState.history.push({ stepId: step.id, output, timestamp: new Date() });
      newState.currentStepIndex = resolveNextStep(flow, step, newState);
      return { output, state: newState };
    }

    default: {
      newState.currentStepIndex++;
      return { output: "", state: newState };
    }
  }
}

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
export function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

function interpolateParams(
  params: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      result[key] = interpolate(value, variables);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveNextStep(
  flow: ConversationFlowDefinition,
  currentStep: FlowStep,
  state: ConversationState,
): number {
  if (currentStep.nextStepId) {
    const idx = flow.steps.findIndex((s) => s.id === currentStep.nextStepId);
    return idx >= 0 ? idx : state.currentStepIndex + 1;
  }
  return state.currentStepIndex + 1;
}

function evaluateBranches(
  flow: ConversationFlowDefinition,
  branches: BranchCondition[],
  variables: Record<string, unknown>,
): number {
  for (const branch of branches) {
    const value = variables[branch.variable];
    if (evaluateCondition(value, branch.operator, branch.value)) {
      const idx = flow.steps.findIndex((s) => s.id === branch.targetStepId);
      if (idx >= 0) return idx;
    }
  }
  // Default: move forward
  return 0;
}

function evaluateCondition(
  value: unknown,
  operator: BranchCondition["operator"],
  target: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return value === target;
    case "neq":
      return value !== target;
    case "gt":
      return Number(value) > Number(target);
    case "lt":
      return Number(value) < Number(target);
    case "gte":
      return Number(value) >= Number(target);
    case "lte":
      return Number(value) <= Number(target);
    case "contains":
      return typeof value === "string" && typeof target === "string"
        ? value.toLowerCase().includes(target.toLowerCase())
        : false;
    case "in":
      return Array.isArray(target) ? target.includes(value) : false;
    default:
      return false;
  }
}
