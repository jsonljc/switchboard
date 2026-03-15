import { describe, it, expect, beforeEach } from "vitest";
import { ConversationRouter } from "../router.js";
import type { InboundMessage } from "../router.js";
import { InMemorySessionStore } from "../session-store.js";
import type { ConversationFlowDefinition } from "../types.js";

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channelId: "ch-1",
    channelType: "sms",
    body: "Hello",
    from: "+15551234567",
    timestamp: new Date(),
    organizationId: "org-1",
    ...overrides,
  };
}

function makeGreetingFlow(): ConversationFlowDefinition {
  return {
    id: "greeting",
    name: "Greeting Flow",
    description: "Simple greeting",
    steps: [
      { id: "intro", type: "message", template: "Welcome! How can I help you?" },
      {
        id: "timeline_question",
        type: "question",
        template: "When are you looking to get started?",
        options: ["Right away", "Within a month", "Just exploring"],
      },
      { id: "thanks", type: "message", template: "Thanks for your response!" },
    ],
    variables: ["contactName", "contactPhone"],
  };
}

function makeEscalateFlow(): ConversationFlowDefinition {
  return {
    id: "escalation",
    name: "Escalation Flow",
    description: "Escalates immediately",
    steps: [{ id: "escalate_step", type: "escalate", escalationReason: "Test escalation" }],
    variables: [],
  };
}

function makeActionFlow(): ConversationFlowDefinition {
  return {
    id: "action_flow",
    name: "Action Flow",
    description: "Triggers an action",
    steps: [
      {
        id: "action_step",
        type: "action",
        actionType: "crm.create_lead",
        actionParameters: { source: "conversation" },
      },
      { id: "done", type: "message", template: "Action dispatched!" },
    ],
    variables: [],
  };
}

function makeMultiStepFlow(): ConversationFlowDefinition {
  return {
    id: "multi",
    name: "Multi-Step Flow",
    description: "Multiple questions to keep session open",
    steps: [
      { id: "intro", type: "message", template: "Welcome! Let's get started." },
      {
        id: "timeline_question",
        type: "question",
        template: "When are you looking to get started?",
        options: ["Right away", "Within a month", "Just exploring"],
      },
      {
        id: "budget_question",
        type: "question",
        template: "What's your budget?",
        options: ["Under $100", "$100-$500", "Over $500"],
      },
      { id: "thanks", type: "message", template: "Thanks!" },
    ],
    variables: ["contactName"],
  };
}

function makeCompletionFlow(): ConversationFlowDefinition {
  return {
    id: "completion",
    name: "Completion Flow",
    description: "Completes quickly",
    steps: [{ id: "msg", type: "message", template: "Done!" }],
    variables: [],
  };
}

describe("ConversationRouter", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe("handleMessage", () => {
    it("should create a new session for an unknown channelId", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const result = await router.handleMessage(makeMessage());

      expect(result.handled).toBe(true);
      expect(result.sessionId).toBeTruthy();
      expect(result.responses.length).toBeGreaterThan(0);
    });

    it("should reuse an existing session for the same channelId", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const first = await router.handleMessage(makeMessage());
      const second = await router.handleMessage(makeMessage({ body: "1" }));

      expect(first.sessionId).toBe(second.sessionId);
    });

    it("should return handled=false for an escalated session", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      // Create session
      const first = await router.handleMessage(makeMessage());
      // Escalate it
      await router.escalateSession(first.sessionId!);

      // Next message should not be handled
      const result = await router.handleMessage(makeMessage({ body: "help" }));
      expect(result.handled).toBe(false);
      expect(result.escalated).toBe(true);
      expect(result.responses).toEqual([]);
    });

    it("should match FAQ before running flow when FAQs configured", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
        faqs: [{ question: "What are your hours?", answer: "We are open 9am-5pm." }],
        businessName: "TestClinic",
      });

      // First message creates session
      await router.handleMessage(makeMessage());
      // Ask the FAQ
      const result = await router.handleMessage(makeMessage({ body: "What are your hours?" }));
      expect(result.handled).toBe(true);
      expect(result.responses.length).toBeGreaterThan(0);
      expect(result.responses[0]).toContain("9am-5pm");
    });

    it("should handle numeric option selection", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      // First message creates session → greeting flow starts
      await router.handleMessage(makeMessage());
      // Reply with "1" (first option)
      const result = await router.handleMessage(makeMessage({ body: "1" }));
      expect(result.handled).toBe(true);
    });

    it("should return error response when flow not found", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      // Create session then remove the flow from the map
      await router.handleMessage(makeMessage());
      flows.delete("greeting");

      const result = await router.handleMessage(makeMessage({ body: "hello again" }));
      expect(result.handled).toBe(false);
      expect(result.responses[0]).toContain("error");
    });

    it("should complete and delete session when flow finishes", async () => {
      const flows = new Map([["completion", makeCompletionFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "completion",
      });

      const result = await router.handleMessage(makeMessage());
      expect(result.completed).toBe(true);
      // Session should be deleted
      const session = await store.getByChannelId("ch-1");
      expect(session).toBeNull();
    });

    it("should detect escalation during flow execution", async () => {
      const flows = new Map([["escalation", makeEscalateFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "escalation",
      });

      const result = await router.handleMessage(makeMessage());
      expect(result.escalated).toBe(true);
    });

    it("should include actionRequired when flow triggers an action", async () => {
      const flows = new Map([["action_flow", makeActionFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "action_flow",
      });

      const result = await router.handleMessage(makeMessage());
      expect(result.actionRequired).toBeDefined();
      expect(result.actionRequired?.actionType).toBe("crm.create_lead");
    });
  });

  describe("extractLeadProfileUpdate", () => {
    it("should extract timeline from selectedOption_timeline_question", async () => {
      const flow: ConversationFlowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        steps: [
          {
            id: "timeline_question",
            type: "question",
            template: "When?",
            options: ["Immediate", "Soon", "Exploring"],
          },
          { id: "end", type: "message", template: "Done" },
        ],
        variables: [],
      };
      const flows = new Map([["test", flow]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "test",
      });

      // Create session, then answer with option 1
      await router.handleMessage(makeMessage());
      const result = await router.handleMessage(makeMessage({ body: "1" }));

      if (result.leadProfileUpdate) {
        expect(result.leadProfileUpdate["timeline"]).toBe("immediate");
      }
    });
  });

  describe("startFlow", () => {
    it("should create a session with the specified flow", async () => {
      const flows = new Map([
        ["greeting", makeGreetingFlow()],
        ["completion", makeCompletionFlow()],
      ]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const session = await router.startFlow("ch-2", "web_chat", "completion", "org-1");
      expect(session.flowId).toBe("completion");
      expect(session.channelId).toBe("ch-2");
    });

    it("should end existing session before starting new flow", async () => {
      const flows = new Map([
        ["greeting", makeGreetingFlow()],
        ["completion", makeCompletionFlow()],
      ]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const first = await router.startFlow("ch-2", "web_chat", "greeting", "org-1");
      const second = await router.startFlow("ch-2", "web_chat", "completion", "org-1");

      expect(first.id).not.toBe(second.id);
      // Old session should be gone
      const old = await store.getById(first.id);
      expect(old).toBeNull();
    });

    it("should throw for unknown flow ID", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      await expect(router.startFlow("ch-2", "sms", "nonexistent", "org-1")).rejects.toThrow(
        "Flow nonexistent not found",
      );
    });

    it("should pass initial variables to the flow state", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const session = await router.startFlow("ch-2", "sms", "greeting", "org-1", {
        customVar: "test_value",
      });
      expect(session.state.variables["customVar"]).toBe("test_value");
    });
  });

  describe("escalateSession", () => {
    it("should mark the session as escalated", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const session = await router.startFlow("ch-3", "sms", "greeting", "org-1");
      await router.escalateSession(session.id);

      const updated = await store.getById(session.id);
      expect(updated?.escalated).toBe(true);
    });
  });

  describe("endSession", () => {
    it("should delete the session", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const session = await router.startFlow("ch-4", "sms", "greeting", "org-1");
      await router.endSession(session.id);

      const deleted = await store.getById(session.id);
      expect(deleted).toBeNull();
    });
  });

  describe("state machine integration", () => {
    it("should activate state machine by default on new sessions", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      const result = await router.handleMessage(makeMessage());
      expect(result.machineState).toBeDefined();
      // First message: IDLE -> GREETING via MESSAGE_RECEIVED
      expect(result.machineState).toBe("GREETING");
    });

    it("should advance state machine with INTENT_CLASSIFIED on second message", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      // First message transitions IDLE -> GREETING
      await router.handleMessage(makeMessage());
      // Second message with meaningful intent should advance to QUALIFYING
      const result = await router.handleMessage(makeMessage({ body: "I want teeth whitening" }));
      expect(result.machineState).toBe("QUALIFYING");
    });

    it("should escalate on medical risk message", async () => {
      const flows = new Map([["greeting", makeGreetingFlow()]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "greeting",
      });

      // First message
      await router.handleMessage(makeMessage());
      // Medical risk message
      const result = await router.handleMessage(
        makeMessage({ body: "I'm pregnant, is this safe?" }),
      );
      expect(result.escalated).toBe(true);
    });

    it("should escalate on human request", async () => {
      const multiStepFlow = makeMultiStepFlow();
      const flows = new Map([["multi", multiStepFlow]]);
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "multi",
      });

      // First message: IDLE -> GREETING, then first question shown
      const r1 = await router.handleMessage(makeMessage());
      expect(r1.machineState).toBe("GREETING");
      expect(r1.completed).toBe(false);

      // Second message: answer first question, advance state
      const r2 = await router.handleMessage(makeMessage({ body: "1" }));
      expect(r2.completed).toBe(false);

      // Human request: should escalate
      const r3 = await router.handleMessage(makeMessage({ body: "speak to a human" }));
      expect(r3.escalated).toBe(true);
    });
  });

  describe("createSession error", () => {
    it("should throw when default flow is missing", async () => {
      const flows = new Map<string, ConversationFlowDefinition>();
      const router = new ConversationRouter({
        sessionStore: store,
        flows,
        defaultFlowId: "nonexistent",
      });

      await expect(router.handleMessage(makeMessage())).rejects.toThrow(
        "Default flow nonexistent not found",
      );
    });
  });
});
