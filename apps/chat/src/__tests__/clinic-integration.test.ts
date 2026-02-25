import { describe, it, expect, beforeEach } from "vitest";
import { ChatRuntime } from "../runtime.js";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import type { Interpreter, InterpreterResult } from "../interpreter/interpreter.js";
import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext, CartridgeReadAdapter } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec } from "@switchboard/schemas";
import { deleteThread } from "../conversation/threads.js";
import { AllowedIntent } from "../clinic/types.js";
import type { ReadIntentDescriptor } from "../clinic/types.js";

// ---------------------------------------------------------------------------
// Mock Adapter (same pattern as runtime-integration.test.ts)
// ---------------------------------------------------------------------------
class MockAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  sentText: Array<{ threadId: string; text: string }> = [];
  sentApprovalCards: Array<{ threadId: string; card: ApprovalCardPayload }> = [];
  sentResultCards: Array<{ threadId: string; card: ResultCardPayload }> = [];
  private nextMessage: IncomingMessage | null = null;

  setNextMessage(msg: IncomingMessage): void {
    this.nextMessage = msg;
  }

  parseIncomingMessage(_rawPayload: unknown): IncomingMessage | null {
    return this.nextMessage;
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    this.sentText.push({ threadId, text });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    this.sentApprovalCards.push({ threadId, card });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    this.sentResultCards.push({ threadId, card });
  }

  extractMessageId(_rawPayload: unknown): string | null {
    return null;
  }

  reset(): void {
    this.sentText = [];
    this.sentApprovalCards = [];
    this.sentResultCards = [];
    this.nextMessage = null;
  }
}

// ---------------------------------------------------------------------------
// Mock Interpreter that returns read intents
// ---------------------------------------------------------------------------
class MockClinicInterpreter implements Interpreter {
  private nextResult: InterpreterResult | null = null;

  setNextResult(result: InterpreterResult): void {
    this.nextResult = result;
  }

  async interpret(
    _text: string,
    _ctx: Record<string, unknown>,
    _actions: string[],
  ): Promise<InterpreterResult> {
    if (this.nextResult) return this.nextResult;
    return {
      proposals: [],
      needsClarification: true,
      clarificationQuestion: "I don't understand.",
      confidence: 0,
      rawResponse: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Mock ReadAdapter
// ---------------------------------------------------------------------------
function createMockReadAdapter(
  data: unknown = [],
  traceId: string = "trace_mock",
): CartridgeReadAdapter {
  return {
    query: async () => ({ data, traceId }),
  } as unknown as CartridgeReadAdapter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: "thread_clinic",
    principalId: "user_1",
    organizationId: null,
    text,
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

function makeIdentitySpec(overrides?: Partial<IdentitySpec>): IdentitySpec {
  const now = new Date();
  return {
    id: "spec_test",
    principalId: "user_1",
    organizationId: null,
    name: "Test User",
    description: "Test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: ["user_1"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const MOCK_CAMPAIGNS = [
  {
    id: "camp_1",
    name: "Summer Sale",
    campaignStatus: "ACTIVE",
    dailyBudget: 5000,
    deliveryStatus: "ACTIVE",
    objective: "LEAD_GENERATION",
  },
  {
    id: "camp_2",
    name: "Winter Promo",
    campaignStatus: "PAUSED",
    dailyBudget: 3000,
    deliveryStatus: "OFF",
    objective: "CONVERSIONS",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Clinic Integration", () => {
  let adapter: MockAdapter;
  let storage: StorageContext;
  let orchestrator: LifecycleOrchestrator;

  beforeEach(async () => {
    adapter = new MockAdapter();
    storage = createInMemoryStorage();
    const ledgerStorage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

    const cartridge = new TestCartridge(createTestManifest({ id: "ads-spend" }));
    cartridge.onRiskInput(() => ({
      baseRisk: "high" as const,
      exposure: { dollarsAtRisk: 500, blastRadius: 1 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));
    cartridge.onExecute((_actionType, params) => ({
      success: true,
      summary: `Campaign ${(params["campaignId"] as string) ?? "unknown"} modified`,
      externalRefs: { campaignId: (params["campaignId"] as string) ?? "unknown" },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: 15,
      undoRecipe: {
        originalActionId: (params["_actionId"] as string) ?? "unknown",
        originalEnvelopeId: (params["_envelopeId"] as string) ?? "unknown",
        reverseActionType: "ads.campaign.resume",
        reverseParameters: { campaignId: params["campaignId"] },
        undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        undoRiskCategory: "medium",
        undoApprovalRequired: "none",
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cartridge as any).resolveEntity = async (
      inputRef: string,
      entityType: string,
    ) => ({
      id: `resolve_${Date.now()}`,
      inputRef,
      resolvedType: entityType,
      resolvedId: "camp_123",
      resolvedName: inputRef,
      confidence: 0.95,
      alternatives: [],
      status: "resolved" as const,
    });

    storage.cartridges.register("ads-spend", cartridge);

    // Seed a default allow policy (policy engine now defaults to deny when no policy matches)
    await storage.policies.save({
      id: "default-allow-ads",
      name: "Default allow ads-spend",
      description: "Allow all ads-spend actions",
      organizationId: null,
      cartridgeId: "ads-spend",
      priority: 100,
      active: true,
      rule: { composition: "AND", conditions: [], children: [] },
      effect: "allow",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await storage.identity.saveSpec(makeIdentitySpec());
    await storage.identity.savePrincipal({
      id: "user_1",
      type: "user",
      name: "Test User",
      organizationId: null,
      roles: ["requester", "approver"],
    });

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
      routingConfig: {
        defaultApprovers: ["user_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny" as const,
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
      },
    });

    deleteThread("thread_clinic");
  });

  // ---------------------------------------------------------------------------
  // Read flow: interpreter returns readIntent → read handler → text reply
  // ---------------------------------------------------------------------------
  describe("read flow", () => {
    it("sends performance report for read intent", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      const readIntent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.95,
      };
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.95,
        rawResponse: "{}",
        readIntent,
      });

      const readAdapter = createMockReadAdapter(MOCK_CAMPAIGNS);
      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause", "ads.campaign.resume", "ads.budget.adjust"],
        readAdapter,
      });

      adapter.setNextMessage(makeMessage("how are my campaigns doing?"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Campaign Performance Report");
      expect(adapter.sentText[0]!.text).toContain("Summer Sale");
      expect(adapter.sentText[0]!.text).toContain("Winter Promo");
      // No approval cards
      expect(adapter.sentApprovalCards).toHaveLength(0);
    });

    it("sends campaign status card for check_status with campaignRef", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      const readIntent: ReadIntentDescriptor = {
        intent: AllowedIntent.CHECK_STATUS,
        slots: { campaignRef: "Summer Sale" },
        confidence: 0.9,
      };
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.9,
        rawResponse: "{}",
        readIntent,
      });

      const readAdapter = createMockReadAdapter([MOCK_CAMPAIGNS[0]]);
      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
        readAdapter,
      });

      adapter.setNextMessage(makeMessage("status of Summer Sale"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Campaign: Summer Sale");
    });

    it("sends recommendations for more_leads intent", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      const readIntent: ReadIntentDescriptor = {
        intent: AllowedIntent.MORE_LEADS,
        slots: {},
        confidence: 0.85,
      };
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.85,
        rawResponse: "{}",
        readIntent,
      });

      const readAdapter = createMockReadAdapter(MOCK_CAMPAIGNS);
      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
        readAdapter,
      });

      adapter.setNextMessage(makeMessage("I want more patient leads"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Recommendations for More Leads");
    });

    it("sends error message when readAdapter is not configured", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      const readIntent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.9,
      };
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.9,
        rawResponse: "{}",
        readIntent,
      });

      // No readAdapter configured
      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
      });

      adapter.setNextMessage(makeMessage("how are my campaigns?"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Read operations are not configured");
    });

    it("sends error message when readAdapter throws", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      const readIntent: ReadIntentDescriptor = {
        intent: AllowedIntent.REPORT_PERFORMANCE,
        slots: {},
        confidence: 0.9,
      };
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.9,
        rawResponse: "{}",
        readIntent,
      });

      const readAdapter = {
        query: async () => { throw new Error("Connection timeout"); },
      } as unknown as CartridgeReadAdapter;

      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
        readAdapter,
      });

      adapter.setNextMessage(makeMessage("how are my campaigns?"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Error reading data");
      expect(adapter.sentText[0]!.text).toContain("Connection timeout");
    });
  });

  // ---------------------------------------------------------------------------
  // Write flow: interpreter returns proposals → orchestrator → approval card
  // ---------------------------------------------------------------------------
  describe("write flow with clinic interpreter", () => {
    it("sends approval card for write intent (pause)", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      mockInterpreter.setNextResult({
        proposals: [{
          id: "prop_test_1",
          actionType: "ads.campaign.pause",
          parameters: { campaignRef: "Summer Sale" },
          evidence: "Clinic intent: pause",
          confidence: 0.95,
          originatingMessageId: "",
        }],
        needsClarification: false,
        clarificationQuestion: null,
        confidence: 0.95,
        rawResponse: "{}",
      });

      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause", "ads.campaign.resume", "ads.budget.adjust"],
      });

      adapter.setNextMessage(makeMessage("pause Summer Sale"));
      await runtime.handleIncomingMessage({});

      // Should get an approval card (not a text reply)
      expect(adapter.sentApprovalCards).toHaveLength(1);
      expect(adapter.sentApprovalCards[0]!.card.summary).toContain("pause");
    });
  });

  // ---------------------------------------------------------------------------
  // Clarification flow: interpreter returns needsClarification
  // ---------------------------------------------------------------------------
  describe("clarification flow", () => {
    it("sends clarification for unknown message", async () => {
      const mockInterpreter = new MockClinicInterpreter();
      mockInterpreter.setNextResult({
        proposals: [],
        needsClarification: true,
        clarificationQuestion: "I can help with campaign reports, pausing, resuming, or budgets.",
        confidence: 0.2,
        rawResponse: "{}",
      });

      const runtime = new ChatRuntime({
        adapter,
        interpreter: mockInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
      });

      adapter.setNextMessage(makeMessage("what's the weather?"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("campaign reports");
    });
  });

  // ---------------------------------------------------------------------------
  // Backward compatibility: RuleBasedInterpreter never sets readIntent
  // ---------------------------------------------------------------------------
  describe("backward compatibility", () => {
    it("RuleBasedInterpreter works without readAdapter", async () => {
      const ruleInterpreter = new RuleBasedInterpreter();
      const runtime = new ChatRuntime({
        adapter,
        interpreter: ruleInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause", "ads.campaign.resume", "ads.budget.adjust"],
        // No readAdapter
      });

      adapter.setNextMessage(makeMessage("pause Summer Sale"));
      await runtime.handleIncomingMessage({});

      // RuleBasedInterpreter produces proposals, not readIntent
      // Should get approval card
      expect(adapter.sentApprovalCards).toHaveLength(1);
    });

    it("RuleBasedInterpreter unknown messages still produce clarification", async () => {
      const ruleInterpreter = new RuleBasedInterpreter();
      const runtime = new ChatRuntime({
        adapter,
        interpreter: ruleInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
      });

      adapter.setNextMessage(makeMessage("what is the weather"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText.length).toBeGreaterThan(0);
      expect(adapter.sentText[0]!.text).toContain("not sure");
    });

    it("RuleBasedInterpreter help command still works", async () => {
      const ruleInterpreter = new RuleBasedInterpreter();
      const runtime = new ChatRuntime({
        adapter,
        interpreter: ruleInterpreter,
        orchestrator,
        availableActions: ["ads.campaign.pause"],
      });

      adapter.setNextMessage(makeMessage("help"));
      await runtime.handleIncomingMessage({});

      expect(adapter.sentText).toHaveLength(1);
      expect(adapter.sentText[0]!.text).toContain("Available actions");
    });
  });
});
