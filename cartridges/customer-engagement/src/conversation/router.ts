// ---------------------------------------------------------------------------
// Conversation Router — Maps inbound messages to active conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "./types.js";
import type { ConversationSession, ConversationSessionStore } from "./session-store.js";
import { createConversationState, executeNextStep } from "./engine.js";
import { ConversationNLPAdapter } from "./nlp-adapter.js";
import type { FAQRecord } from "@switchboard/schemas";
import { matchFAQ, formatFAQResponse } from "./faq-matcher.js";
import {
  createLeadStateMachine,
  getGoalForState,
  LeadConversationEvent,
  LeadConversationState,
  type LeadStateMachineContext,
} from "./lead-state-machine.js";
import type { ClassificationResult } from "./intent-classifier.js";
import { matchObjection, type ObjectionMatch } from "../agents/intake/objection-trees.js";

export interface InboundMessage {
  /** Channel identifier (phone number, chat widget ID) */
  channelId: string;
  /** Channel type */
  channelType: "sms" | "web_chat" | "instagram_dm" | "facebook_messenger" | "whatsapp" | "telegram";
  /** Message body text */
  body: string;
  /** Sender identifier */
  from: string;
  /** Timestamp */
  timestamp: Date;
  /** Organization ID */
  organizationId: string;
  /** Additional metadata (e.g. Twilio message SID) */
  metadata?: Record<string, unknown>;
}

export interface RouterResponse {
  /** Whether the message was handled */
  handled: boolean;
  /** Response message(s) to send back */
  responses: string[];
  /** Whether an action needs to be dispatched */
  actionRequired?: {
    actionType: string;
    parameters: Record<string, unknown>;
  };
  /** Whether the conversation was escalated to a human */
  escalated: boolean;
  /** Whether the conversation was completed */
  completed: boolean;
  /** Session ID */
  sessionId: string | null;
  /** Conversation state variables (exposed on completion for callers to read) */
  variables?: Record<string, unknown>;
  /** Typed lead profile fields extracted from question answers */
  leadProfileUpdate?: Record<string, unknown>;
  /** Current lead state machine state (if enabled). */
  machineState?: string;
  /** LLM goal description for the current state (if state machine enabled). */
  stateGoal?: string;
  /** FAQ answer text, when response came from FAQ matching (allows LLM to rephrase) */
  faqContext?: string;
  /** Unanswered question text, when a question didn't match any FAQ */
  unansweredQuestion?: string;
}

export interface ConversationRouterConfig {
  sessionStore: ConversationSessionStore;
  /** Map of flow ID → flow definition */
  flows: Map<string, ConversationFlowDefinition>;
  /** Default flow to start for new conversations */
  defaultFlowId: string;
  /** Session timeout in ms (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** FAQ records for direct-answer routing before qualification flow */
  faqs?: FAQRecord[];
  /** Business name for FAQ response formatting */
  businessName?: string;
  /** Objection trees for keyword-matched objection handling */
  objectionTrees?: ObjectionMatch[];
}

/**
 * Routes inbound messages to active conversation flows.
 *
 * Flow:
 * 1. Look up active session by channelId
 * 2. If no session, create one with the default flow
 * 3. Process the message through the conversation engine
 * 4. Return response messages and any actions to dispatch
 */
export class ConversationRouter {
  private readonly sessionStore: ConversationSessionStore;
  private readonly flows: Map<string, ConversationFlowDefinition>;
  private readonly defaultFlowId: string;
  private readonly sessionTimeoutMs: number;
  private readonly nlpAdapter: ConversationNLPAdapter;
  private readonly faqs: FAQRecord[];
  private readonly businessName: string | undefined;
  private readonly objectionTrees: ObjectionMatch[];

  constructor(config: ConversationRouterConfig) {
    this.sessionStore = config.sessionStore;
    this.flows = config.flows;
    this.defaultFlowId = config.defaultFlowId;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
    this.nlpAdapter = new ConversationNLPAdapter();
    this.faqs = config.faqs ?? [];
    this.businessName = config.businessName;
    this.objectionTrees = config.objectionTrees ?? [];
  }

  /**
   * Handle an inbound message. Returns the response to send back.
   */
  async handleMessage(message: InboundMessage): Promise<RouterResponse> {
    // Step 1: Find or create a session
    let session = await this.sessionStore.getByChannelId(message.channelId);

    if (!session) {
      session = await this.createSession(message);
    }

    // Step 1.5: Advance lead state machine (if enabled)
    // Classify intent first so we can dispatch semantic events
    const classification = this.nlpAdapter.classifier.classify(message.body);

    if (session.machineState !== undefined) {
      const sm = createLeadStateMachine();
      sm.hydrate(session.machineState as LeadConversationState);
      const smCtx = this.buildStateMachineContext(session, classification);

      // Dispatch semantic events based on classification and context
      const events = this.resolveSemanticEvents(sm.currentState, classification, smCtx);
      for (const event of events) {
        const smResult = await sm.transition(event, smCtx);
        if (smResult.success) {
          session.machineState = sm.currentState;
        }
      }

      // If state machine reached ESCALATING, mark session as escalated
      if (
        sm.currentState === LeadConversationState.ESCALATING ||
        sm.currentState === LeadConversationState.HUMAN_ACTIVE
      ) {
        session.escalated = true;
        await this.sessionStore.update(session.id, {
          escalated: true,
          machineState: session.machineState,
        });
      }
    }

    // Step 2: If escalated, don't process further
    if (session.escalated) {
      return {
        handled: false,
        responses: [],
        escalated: true,
        completed: false,
        sessionId: session.id,
      };
    }

    // Step 2.5: FAQ matching — if FAQs are configured, try to answer directly before flow
    if (this.faqs.length > 0) {
      const faqResult = matchFAQ(message.body, this.faqs);
      if (faqResult.tier === "direct" || faqResult.tier === "caveat") {
        const faqResponse = formatFAQResponse(faqResult, this.businessName);
        if (faqResponse) {
          return {
            handled: true,
            responses: [faqResponse],
            escalated: false,
            completed: false,
            sessionId: session.id,
            machineState: session.machineState,
            stateGoal: session.machineState
              ? getGoalForState(session.machineState as LeadConversationState)
              : undefined,
            faqContext: faqResponse,
          };
        }
      }
    }

    // Detect unanswered questions — classified as question but FAQ didn't match (or no FAQs)
    if (classification.intent === "question") {
      session.state.variables["unansweredQuestion"] = message.body;
    }

    // Step 3: Set the user's response as a variable
    const state = { ...session.state };
    state.variables = {
      ...state.variables,
      lastMessage: message.body,
      lastMessageLower: message.body.toLowerCase().trim(),
      contactPhone: message.from,
    };

    // Use NLP adapter to interpret the message before falling back to numeric matching
    const flow = this.flows.get(session.flowId);
    if (flow) {
      const currentStep = flow.steps[state.currentStepIndex] ?? null;
      const nlpResult = this.nlpAdapter.processMessage(message.body, currentStep);

      // Set extracted variables
      Object.assign(state.variables, nlpResult.extractedVariables);

      // Update contactName if NLP extracted a name (e.g., "my name is Sarah")
      if (nlpResult.extractedVariables["name"]) {
        state.variables["contactName"] = nlpResult.extractedVariables["name"] as string;
      }

      // If NLP resolved an option, set it (both generic and step-specific key)
      if (nlpResult.resolvedOptionIndex !== null) {
        state.variables["selectedOption"] = nlpResult.resolvedOptionIndex;
        if (currentStep) {
          state.variables[`selectedOption_${currentStep.id}`] = nlpResult.resolvedOptionIndex;
        }
      }

      // Handle escalation requests
      if (nlpResult.classification.intent === "escalation_request") {
        state.variables["escalationRequested"] = true;
      }

      // Wire objection response when intent is objection
      if (classification.intent === "objection") {
        const objMatch = matchObjection(
          message.body,
          this.objectionTrees.length > 0 ? this.objectionTrees : undefined,
        );
        if (objMatch) {
          state.variables["objectionCategory"] = objMatch.category;
          state.variables["objectionResponse"] = objMatch.response;
          state.variables["objectionFollowUp"] = objMatch.followUp;
        }
      }
    } else {
      // Fallback: try to interpret the message as a question response (numbered option)
      const optionMatch = message.body.trim().match(/^(\d+)$/);
      if (optionMatch) {
        state.variables["selectedOption"] = parseInt(optionMatch[1]!, 10);
      }
    }

    // Step 4: Execute the next step(s) in the conversation
    if (!flow) {
      return {
        handled: false,
        responses: ["Sorry, there was an error processing your message. Please try again later."],
        escalated: false,
        completed: false,
        sessionId: session.id,
      };
    }

    const responses: string[] = [];
    let currentState = state;
    let actionRequired: RouterResponse["actionRequired"];
    let escalated = false;
    let completed = false;

    // Execute steps until we hit a wait, question, or end
    let maxSteps = 10; // Safety limit
    while (maxSteps-- > 0) {
      const result = executeNextStep(flow, currentState);
      currentState = result.state;

      if (result.output) {
        responses.push(result.output);
      }

      if (result.actionRequired) {
        actionRequired = result.actionRequired;
      }

      if (currentState.escalated) {
        escalated = true;
        break;
      }

      if (currentState.completed) {
        completed = true;
        break;
      }

      // Stop if the current step is a question or wait (needs user input)
      const currentStep = flow.steps[currentState.currentStepIndex];
      if (currentStep?.type === "question" || currentStep?.type === "wait") {
        break;
      }

      // If we just processed a question, we need the next step
      // but only if the output was non-empty (we got a response)
      if (!result.output && currentState.currentStepIndex >= flow.steps.length) {
        completed = true;
        break;
      }
    }

    // Step 5: Update the session
    await this.sessionStore.update(session.id, {
      state: currentState,
      escalated,
      lastActivityAt: new Date(),
      machineState: session.machineState,
    });

    // If completed, clean up the session
    if (completed) {
      await this.sessionStore.delete(session.id);
    }

    // Extract lead profile updates from question answers
    const leadProfileUpdate = extractLeadProfileUpdate(currentState.variables);

    return {
      handled: true,
      responses,
      actionRequired,
      escalated,
      completed,
      sessionId: session.id,
      variables: currentState.variables,
      leadProfileUpdate: Object.keys(leadProfileUpdate).length > 0 ? leadProfileUpdate : undefined,
      machineState: session.machineState,
      stateGoal: session.machineState
        ? getGoalForState(session.machineState as LeadConversationState)
        : undefined,
      unansweredQuestion: currentState.variables["unansweredQuestion"] as string | undefined,
    };
  }

  /** Build state machine context from session state and classification. */
  private buildStateMachineContext(
    session: ConversationSession,
    classification: ClassificationResult,
  ): LeadStateMachineContext {
    const history = session.state.history;
    const signalsCaptured = this.countSignalsCaptured(session);
    return {
      turnCount: history.length,
      signalsCaptured,
      totalSignals: 3,
      engagementLevel: this.inferEngagement(history),
      hasObjection: classification.intent === "objection",
      maxTurnsBeforeEscalation: 15,
    };
  }

  /** Count qualification signals captured from session variables. */
  private countSignalsCaptured(session: ConversationSession): number {
    const vars = session.state.variables;
    let count = 0;
    if (vars["selectedOption_timeline_question"] !== undefined) count++;
    if (vars["selectedOption_budget_question"] !== undefined) count++;
    if (vars["selectedOption_insurance_question"] !== undefined) count++;
    return count;
  }

  /** Infer engagement level from conversation history length. */
  private inferEngagement(
    history: Array<{ stepId: string }>,
  ): LeadStateMachineContext["engagementLevel"] {
    // Use turn count as a proxy for engagement
    if (history.length <= 2) return "high";
    if (history.length >= 12) return "declining";
    if (history.length >= 8) return "low";
    return "medium";
  }

  /**
   * Resolve semantic events to dispatch based on classification, current state, and context.
   * Returns an ordered list of events; the state machine processes them sequentially.
   */
  private resolveSemanticEvents(
    currentState: LeadConversationState,
    classification: ClassificationResult,
    ctx: LeadStateMachineContext,
  ): LeadConversationEvent[] {
    const events: LeadConversationEvent[] = [];

    // Medical risk → immediate escalation from any state
    if (classification.intent === "medical_risk") {
      events.push(LeadConversationEvent.ESCALATION_TRIGGERED);
      return events;
    }

    // Human request → escalation
    if (classification.intent === "escalation_request") {
      events.push(LeadConversationEvent.HUMAN_REQUESTED);
      return events;
    }

    // Objection detected
    if (classification.intent === "objection") {
      events.push(LeadConversationEvent.OBJECTION_DETECTED);
      return events;
    }

    // Engagement declining
    if (ctx.engagementLevel === "declining") {
      events.push(LeadConversationEvent.ENGAGEMENT_DECLINING);
      return events;
    }

    // State-specific semantic events
    switch (currentState) {
      case LeadConversationState.IDLE:
        events.push(LeadConversationEvent.MESSAGE_RECEIVED);
        break;

      case LeadConversationState.GREETING:
      case LeadConversationState.CLARIFYING:
      case LeadConversationState.REACTIVATION:
        // Any meaningful message classifies intent
        if (classification.intent !== "off_topic") {
          events.push(LeadConversationEvent.INTENT_CLASSIFIED);
        } else {
          events.push(LeadConversationEvent.MESSAGE_RECEIVED);
        }
        break;

      case LeadConversationState.QUALIFYING:
        // Check if all signals captured
        if (ctx.signalsCaptured >= ctx.totalSignals) {
          events.push(LeadConversationEvent.ALL_SIGNALS_CAPTURED);
        } else if (
          classification.intent === "freeform_answer" ||
          classification.intent === "option_selection"
        ) {
          events.push(LeadConversationEvent.QUALIFICATION_SIGNAL_CAPTURED);
        } else if (classification.intent === "affirmative" && ctx.signalsCaptured > 0) {
          // Ready-now urgency signal
          events.push(LeadConversationEvent.URGENCY_READY_NOW);
        } else {
          events.push(LeadConversationEvent.MESSAGE_RECEIVED);
        }
        break;

      case LeadConversationState.OBJECTION_HANDLING:
        // Positive response to objection handling → resolved
        if (
          classification.intent === "affirmative" ||
          classification.intent === "freeform_answer"
        ) {
          if (ctx.signalsCaptured >= ctx.totalSignals) {
            events.push(LeadConversationEvent.ALL_SIGNALS_CAPTURED);
          } else {
            events.push(LeadConversationEvent.OBJECTION_RESOLVED);
          }
        }
        break;

      case LeadConversationState.SLOWDOWN_MODE:
      case LeadConversationState.FOLLOW_UP_SCHEDULED:
        events.push(LeadConversationEvent.MESSAGE_RECEIVED);
        break;

      default:
        events.push(LeadConversationEvent.MESSAGE_RECEIVED);
        break;
    }

    return events;
  }

  /**
   * Create a new conversation session and execute the initial greeting.
   */
  private async createSession(message: InboundMessage): Promise<ConversationSession> {
    const flow = this.flows.get(this.defaultFlowId);
    if (!flow) {
      throw new Error(`Default flow ${this.defaultFlowId} not found`);
    }

    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state = createConversationState(flow, {
      contactName: (message.metadata?.["contactName"] as string) ?? message.from,
      contactPhone: message.from,
      channelType: message.channelType,
      lastMessage: message.body,
      lastMessageLower: message.body.toLowerCase().trim(),
    });

    const session: ConversationSession = {
      id: sessionId,
      channelId: message.channelId,
      channelType: message.channelType,
      contactId: null,
      organizationId: message.organizationId,
      flowId: this.defaultFlowId,
      state,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      timeoutMs: this.sessionTimeoutMs,
      escalated: false,
      metadata: message.metadata ?? {},
      machineState: LeadConversationState.IDLE,
    };

    await this.sessionStore.create(session);
    return session;
  }

  /**
   * Start a specific flow for a channel.
   */
  async startFlow(
    channelId: string,
    channelType: InboundMessage["channelType"],
    flowId: string,
    organizationId: string,
    variables?: Record<string, unknown>,
  ): Promise<ConversationSession> {
    // End any existing session
    const existing = await this.sessionStore.getByChannelId(channelId);
    if (existing) {
      await this.sessionStore.delete(existing.id);
    }

    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow ${flowId} not found`);
    }

    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state = createConversationState(flow, variables ?? {});

    const session: ConversationSession = {
      id: sessionId,
      channelId,
      channelType,
      contactId: null,
      organizationId,
      flowId,
      state,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      timeoutMs: this.sessionTimeoutMs,
      escalated: false,
      metadata: {},
    };

    await this.sessionStore.create(session);
    return session;
  }

  /**
   * Escalate a session to a human agent.
   */
  async escalateSession(sessionId: string): Promise<void> {
    await this.sessionStore.update(sessionId, { escalated: true });
  }

  /**
   * End a session.
   */
  async endSession(sessionId: string): Promise<void> {
    await this.sessionStore.delete(sessionId);
  }
}

/**
 * Map question answers to typed lead profile fields.
 * Uses the step-specific selectedOption keys set during flow execution.
 */
function extractLeadProfileUpdate(variables: Record<string, unknown>): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  // Timeline: option 1→"immediate", 2→"soon", 3→"exploring"
  const timelineOption = variables["selectedOption_timeline_question"];
  if (timelineOption === 1) update["timeline"] = "immediate";
  else if (timelineOption === 2) update["timeline"] = "soon";
  else if (timelineOption === 3) update["timeline"] = "exploring";

  // Budget: option 1→"ready", 2→"price_sensitive", 3→"flexible"
  const budgetOption = variables["selectedOption_budget_question"];
  if (budgetOption === 1) update["priceReadiness"] = "ready";
  else if (budgetOption === 2) update["priceReadiness"] = "price_sensitive";
  else if (budgetOption === 3) update["priceReadiness"] = "flexible";

  // Insurance: option 1→hasInsurance: true
  const insuranceOption = variables["selectedOption_insurance_question"];
  if (insuranceOption === 1) {
    update["signals"] = { hasInsurance: true };
  }

  // Mark qualification as complete if score was computed
  if (variables["leadScore"] !== undefined) {
    update["qualificationComplete"] = true;
  }

  return update;
}
