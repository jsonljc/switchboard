// ---------------------------------------------------------------------------
// Conversation Router — Maps inbound messages to active conversation flows
// ---------------------------------------------------------------------------

import type { ConversationFlowDefinition } from "./types.js";
import type { ConversationSession, ConversationSessionStore } from "./session-store.js";
import { createConversationState, executeNextStep } from "./engine.js";
import { ConversationNLPAdapter } from "./nlp-adapter.js";

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
}

export interface ConversationRouterConfig {
  sessionStore: ConversationSessionStore;
  /** Map of flow ID → flow definition */
  flows: Map<string, ConversationFlowDefinition>;
  /** Default flow to start for new conversations */
  defaultFlowId: string;
  /** Session timeout in ms (default: 30 minutes) */
  sessionTimeoutMs?: number;
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

  constructor(config: ConversationRouterConfig) {
    this.sessionStore = config.sessionStore;
    this.flows = config.flows;
    this.defaultFlowId = config.defaultFlowId;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
    this.nlpAdapter = new ConversationNLPAdapter();
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

      // If NLP resolved an option, set it
      if (nlpResult.resolvedOptionIndex !== null) {
        state.variables["selectedOption"] = nlpResult.resolvedOptionIndex;
      }

      // Handle escalation requests
      if (nlpResult.classification.intent === "escalation_request") {
        state.variables["escalationRequested"] = true;
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
    });

    // If completed, clean up the session
    if (completed) {
      await this.sessionStore.delete(session.id);
    }

    return {
      handled: true,
      responses,
      actionRequired,
      escalated,
      completed,
      sessionId: session.id,
    };
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
      contactName: message.from,
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
