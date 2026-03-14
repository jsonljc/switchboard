// ---------------------------------------------------------------------------
// Flow Builder — Fluent API for constructing conversation flow definitions
// ---------------------------------------------------------------------------

import type { FlowDefinition, FlowStep, BranchCondition } from "@switchboard/schemas";

export class FlowBuilder {
  private id: string;
  private name: string;
  private description = "";
  private steps: FlowStep[] = [];
  private variables: string[] = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  describe(description: string): this {
    this.description = description;
    return this;
  }

  addVariable(name: string): this {
    if (!this.variables.includes(name)) {
      this.variables.push(name);
    }
    return this;
  }

  addMessage(id: string, template: string, options?: { nextStepId?: string }): this {
    this.steps.push({ id, type: "message", template, nextStepId: options?.nextStepId });
    return this;
  }

  addQuestion(
    id: string,
    template: string,
    questionOptions: string[],
    options?: { nextStepId?: string },
  ): this {
    this.steps.push({
      id,
      type: "question",
      template,
      options: questionOptions,
      nextStepId: options?.nextStepId,
    });
    return this;
  }

  addBranch(id: string, branches: BranchCondition[]): this {
    this.steps.push({ id, type: "branch", branches });
    return this;
  }

  addAction(
    id: string,
    actionType: string,
    parameters?: Record<string, unknown>,
    options?: { nextStepId?: string },
  ): this {
    this.steps.push({
      id,
      type: "action",
      actionType,
      actionParameters: parameters,
      nextStepId: options?.nextStepId,
    });
    return this;
  }

  addWait(id: string, waitMs: number, options?: { nextStepId?: string }): this {
    this.steps.push({ id, type: "wait", waitMs, nextStepId: options?.nextStepId });
    return this;
  }

  addEscalate(id: string, reason?: string): this {
    this.steps.push({ id, type: "escalate", escalationReason: reason });
    return this;
  }

  addScore(id: string, options?: { nextStepId?: string }): this {
    this.steps.push({ id, type: "score", nextStepId: options?.nextStepId });
    return this;
  }

  build(): FlowDefinition {
    if (this.steps.length === 0) {
      throw new Error("Flow must have at least one step");
    }
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      steps: this.steps,
      variables: this.variables,
    };
  }
}
