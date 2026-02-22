import { randomUUID } from "node:crypto";
import type { ActionProposal } from "@switchboard/schemas";

export class ActionBuilder {
  private actionType: string;
  private params: Record<string, unknown> = {};
  private evidenceText = "";
  private confidenceValue = 1.0;
  private messageId = "";

  constructor(actionType: string) {
    this.actionType = actionType;
  }

  parameter(key: string, value: unknown): this {
    this.params[key] = value;
    return this;
  }

  parameters(params: Record<string, unknown>): this {
    this.params = { ...this.params, ...params };
    return this;
  }

  evidence(text: string): this {
    this.evidenceText = text;
    return this;
  }

  confidence(value: number): this {
    this.confidenceValue = Math.max(0, Math.min(1, value));
    return this;
  }

  originatingMessage(messageId: string): this {
    this.messageId = messageId;
    return this;
  }

  build(): ActionProposal {
    return {
      id: `proposal_${randomUUID()}`,
      actionType: this.actionType,
      parameters: this.params,
      evidence: this.evidenceText,
      confidence: this.confidenceValue,
      originatingMessageId: this.messageId,
    };
  }
}

export function action(actionType: string): ActionBuilder {
  return new ActionBuilder(actionType);
}
