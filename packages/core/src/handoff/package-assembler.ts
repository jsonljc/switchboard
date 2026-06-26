// ---------------------------------------------------------------------------
// Handoff Package Assembler — builds context for human agents
// ---------------------------------------------------------------------------

import type {
  Handoff,
  HandoffReason,
  LeadSnapshot,
  QualificationSnapshot,
  HandoffConversationSummary,
} from "./types.js";
import { randomUUID } from "node:crypto";

export interface AssemblerInput {
  sessionId: string;
  organizationId: string;
  reason: HandoffReason;
  leadSnapshot: LeadSnapshot;
  qualificationSnapshot: QualificationSnapshot;
  messages: Array<{ role: string; text: string }>;
  slaMinutes?: number;
  /**
   * The escalating agent's own free-text summary of why the handoff is needed.
   * Carried verbatim into `conversationSummary.agentSummary`. Used when the tool
   * escalates from a summary alone (empty `messages`), so the operator gets real
   * context instead of a keyword-derived blank.
   */
  agentSummary?: string;
  /**
   * The agent's direct read of the customer's sentiment. When present it is
   * preferred over the keyword estimate (which sees an empty transcript on a
   * summary-only escalation), so the operator sees "angry"/"frustrated" rather
   * than a default "neutral".
   */
  customerSentiment?: string;
}

export class HandoffPackageAssembler {
  assemble(input: AssemblerInput): Handoff {
    const summary = this.buildSummary(input.messages, input.agentSummary, input.customerSentiment);
    const slaMinutes = input.slaMinutes ?? 30;

    return {
      id: `handoff_${randomUUID()}`,
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      reason: input.reason,
      status: "pending",
      leadSnapshot: input.leadSnapshot,
      qualificationSnapshot: input.qualificationSnapshot,
      conversationSummary: summary,
      slaDeadlineAt: new Date(Date.now() + slaMinutes * 60 * 1000),
      createdAt: new Date(),
    };
  }

  private buildSummary(
    messages: Array<{ role: string; text: string }>,
    agentSummary?: string,
    customerSentiment?: string,
  ): HandoffConversationSummary {
    const userMessages = messages.filter((m) => m.role === "user");
    const keyTopics = this.extractKeyTopics(userMessages.map((m) => m.text));
    const objectionHistory = this.extractObjections(userMessages.map((m) => m.text));
    // Prefer the agent's direct read of sentiment; fall back to the keyword
    // estimate (which sees an empty transcript on a summary-only escalation).
    const sentiment = customerSentiment ?? this.estimateSentiment(userMessages.map((m) => m.text));

    return {
      turnCount: userMessages.length,
      keyTopics,
      objectionHistory,
      sentiment,
      suggestedOpening: this.suggestOpening(keyTopics, sentiment),
      ...(agentSummary ? { agentSummary } : {}),
    };
  }

  private extractKeyTopics(texts: string[]): string[] {
    const topicPatterns: Array<{ pattern: RegExp; topic: string }> = [
      { pattern: /\b(price|cost|how much|expensive|budget)\b/i, topic: "pricing" },
      { pattern: /\b(book|appointment|schedule|slot|available)\b/i, topic: "booking" },
      { pattern: /\b(pain|hurt|afraid|scared|nervous)\b/i, topic: "anxiety" },
      { pattern: /\b(insurance|coverage|claim)\b/i, topic: "insurance" },
      { pattern: /\b(time|how long|duration|quick)\b/i, topic: "timing" },
    ];

    const found = new Set<string>();
    for (const text of texts) {
      for (const { pattern, topic } of topicPatterns) {
        if (pattern.test(text)) found.add(topic);
      }
    }
    return [...found];
  }

  private extractObjections(texts: string[]): string[] {
    const objections: string[] = [];
    const objectionPatterns = [
      { pattern: /\b(too expensive|can't afford|too much)\b/i, label: "price concern" },
      { pattern: /\b(not sure|need to think|maybe later)\b/i, label: "hesitation" },
      { pattern: /\b(scared|afraid|nervous|worried)\b/i, label: "anxiety" },
    ];

    for (const text of texts) {
      for (const { pattern, label } of objectionPatterns) {
        if (pattern.test(text) && !objections.includes(label)) {
          objections.push(label);
        }
      }
    }
    return objections;
  }

  private estimateSentiment(texts: string[]): string {
    if (texts.length === 0) return "neutral";
    const last = texts[texts.length - 1]!.toLowerCase();
    if (/\b(angry|frustrated|terrible|worst|hate)\b/.test(last)) return "negative";
    if (/\b(great|thanks|appreciate|happy|wonderful)\b/.test(last)) return "positive";
    return "neutral";
  }

  private suggestOpening(topics: string[], sentiment: string): string {
    // The agent-supplied sentiment vocabulary ("frustrated"/"angry") joins the
    // keyword estimator's "negative" here, so a hostile escalation still opens
    // empathetically rather than dropping to the generic greeting.
    if (sentiment === "negative" || sentiment === "frustrated" || sentiment === "angry") {
      return "Hi, I understand there have been some concerns. I'm here to help sort things out personally.";
    }
    if (topics.includes("pricing")) {
      return "Hi! I saw you had some questions about pricing. Happy to walk you through our options.";
    }
    if (topics.includes("booking")) {
      return "Hi! I'd love to help you find a convenient time. Let me check what we have available.";
    }
    return "Hi! Thanks for your interest. I'm here to help with any questions you have.";
  }
}
