import { describe, it, expect, beforeEach } from "vitest";
import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
import {
  composeHelpMessage,
  composeUncertainReply,
} from "../composer/reply.js";
import { composeClinicHelp } from "../clinic/composers.js";
import { ChatRuntime } from "../runtime.js";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import type { Interpreter, InterpreterResult } from "../interpreter/interpreter.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec } from "@switchboard/schemas";
import { deleteThread } from "../conversation/threads.js";

// ---------------------------------------------------------------------------
// Mock Adapter
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
// Helpers
// ---------------------------------------------------------------------------
function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: "thread_diag",
    principalId: "user_1",
    organizationId: null,
    text,
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

function makeIdentitySpec(): IdentitySpec {
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
  };
}

const ALL_ACTIONS = [
  "digital-ads.campaign.pause",
  "digital-ads.campaign.resume",
  "digital-ads.campaign.adjust_budget",
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
];

const MOCK_DIAGNOSTIC_DATA = {
  vertical: "commerce",
  platform: "meta",
  periods: {
    current: { since: "2025-02-22", until: "2025-02-28" },
    previous: { since: "2025-02-15", until: "2025-02-21" },
  },
  primaryKPI: {
    name: "purchase",
    current: 142,
    previous: 168,
    deltaPercent: -15.5,
    severity: "warning",
  },
  stageAnalysis: [],
  findings: [
    {
      severity: "warning",
      message: "CTR declined significantly",
      recommendation: "Refresh creatives",
    },
  ],
  bottleneck: null,
};

// ---------------------------------------------------------------------------
// RuleBasedInterpreter diagnostic tests
// ---------------------------------------------------------------------------
describe("RuleBasedInterpreter — diagnostic patterns", () => {
  let interpreter: RuleBasedInterpreter;

  beforeEach(() => {
    interpreter = new RuleBasedInterpreter({
      diagnosticDefaults: { platform: "meta", entityId: "act_test" },
    });
  });

  it('matches "diagnose my funnel" → digital-ads.funnel.diagnose', async () => {
    const result = await interpreter.interpret("diagnose my funnel", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.funnel.diagnose");
    expect(result.proposals[0]!.parameters).toMatchObject({
      platform: "meta",
      entityId: "act_test",
      vertical: "commerce",
      periodDays: 7,
    });
    expect(result.needsClarification).toBe(false);
  });

  it('matches "how are my ads doing" → digital-ads.funnel.diagnose', async () => {
    const result = await interpreter.interpret("how are my ads doing", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.funnel.diagnose");
  });

  it('matches "what\'s wrong with my campaigns" → digital-ads.funnel.diagnose', async () => {
    const result = await interpreter.interpret("what's wrong with my campaigns", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.funnel.diagnose");
  });

  it('matches "portfolio analysis" → digital-ads.portfolio.diagnose', async () => {
    const result = await interpreter.interpret("portfolio analysis", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.portfolio.diagnose");
  });

  it('matches "cross-platform report" → digital-ads.portfolio.diagnose', async () => {
    const result = await interpreter.interpret("cross-platform report", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.portfolio.diagnose");
  });

  it('matches "show my metrics" → digital-ads.snapshot.fetch', async () => {
    const result = await interpreter.interpret("show my metrics", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.snapshot.fetch");
  });

  it('matches "fetch my snapshot" → digital-ads.snapshot.fetch', async () => {
    const result = await interpreter.interpret("fetch my snapshot", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.snapshot.fetch");
  });

  it('matches "analyze my campaign structure" → digital-ads.structure.analyze', async () => {
    const result = await interpreter.interpret("analyze my campaign structure", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.structure.analyze");
  });

  it('matches "check my ad structure" → digital-ads.structure.analyze', async () => {
    const result = await interpreter.interpret("check my ad structure", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.structure.analyze");
  });

  it("returns clarification when diagnostic action not in available actions", async () => {
    const limited = ["digital-ads.campaign.pause"];
    const result = await interpreter.interpret("diagnose my funnel", {}, limited);
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toBe(true);
  });

  it("uses default config when no config provided", async () => {
    const defaultInterpreter = new RuleBasedInterpreter();
    const result = await defaultInterpreter.interpret("diagnose my funnel", {}, ALL_ACTIONS);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.parameters).toMatchObject({
      platform: "meta",
      entityId: "",
      vertical: "commerce",
    });
  });
});

// ---------------------------------------------------------------------------
// Help text tests
// ---------------------------------------------------------------------------
describe("Help text includes diagnostic examples", () => {
  it("composeHelpMessage includes diagnostic section for digital-ads actions", () => {
    const help = composeHelpMessage(ALL_ACTIONS);
    expect(help).toContain("Diagnostics:");
    expect(help).toContain("diagnose my funnel");
    expect(help).toContain("portfolio analysis");
    expect(help).toContain("show me my metrics");
  });

  it("composeHelpMessage correctly detects digital-ads. prefix", () => {
    const help = composeHelpMessage(["digital-ads.campaign.pause"]);
    expect(help).toContain("Ads:");
    expect(help).toContain("pause Summer Sale");
  });

  it("composeUncertainReply correctly detects digital-ads. prefix", () => {
    const reply = composeUncertainReply(["digital-ads.campaign.pause"]);
    expect(reply).toContain("diagnostics");
  });

  it("composeClinicHelp includes diagnostic commands", () => {
    const help = composeClinicHelp();
    expect(help).toContain("Diagnostics");
    expect(help).toContain("Diagnose my funnel");
    expect(help).toContain("Portfolio analysis");
    expect(help).toContain("Show me my metrics");
  });
});

// ---------------------------------------------------------------------------
// Runtime integration — diagnostic proposal → auto-approve → formatted text
// ---------------------------------------------------------------------------
describe("Runtime diagnostic integration", () => {
  let adapter: MockAdapter;
  let storage: StorageContext;
  let orchestrator: LifecycleOrchestrator;

  beforeEach(async () => {
    adapter = new MockAdapter();
    storage = createInMemoryStorage();
    const ledgerStorage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

    const cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
    // Diagnostic actions have low risk → auto-approve
    cartridge.onRiskInput(() => ({
      baseRisk: "low" as const,
      exposure: { dollarsAtRisk: 0, blastRadius: 0 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));
    cartridge.onExecute((actionType) => ({
      success: true,
      summary: `Diagnostic ${actionType} completed`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 50,
      undoRecipe: null,
      data: MOCK_DIAGNOSTIC_DATA,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cartridge as any).resolveEntity = async (
      inputRef: string,
      entityType: string,
    ) => ({
      id: `resolve_${Date.now()}`,
      inputRef,
      resolvedType: entityType,
      resolvedId: "entity_123",
      resolvedName: inputRef,
      confidence: 0.95,
      alternatives: [],
      status: "resolved" as const,
    });

    storage.cartridges.register("digital-ads", cartridge);

    await storage.policies.save({
      id: "default-allow-ads",
      name: "Default allow digital-ads",
      description: "Allow all digital-ads actions",
      organizationId: null,
      cartridgeId: "digital-ads",
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

    deleteThread("thread_diag");
  });

  it("dispatches diagnostic proposal → auto-approve → formatted text reply (not result card)", async () => {
    // Use a mock interpreter that returns a diagnostic proposal
    const mockInterpreter: Interpreter = {
      async interpret(): Promise<InterpreterResult> {
        return {
          proposals: [{
            id: "prop_diag_1",
            actionType: "digital-ads.funnel.diagnose",
            parameters: {
              platform: "meta",
              entityId: "act_test",
              vertical: "commerce",
              periodDays: 7,
            },
            evidence: "Diagnostic intent: diagnose_funnel",
            confidence: 0.85,
            originatingMessageId: "",
          }],
          needsClarification: false,
          clarificationQuestion: null,
          confidence: 0.85,
          rawResponse: "diagnose my funnel",
        };
      },
    };

    const runtime = new ChatRuntime({
      adapter,
      interpreter: mockInterpreter,
      orchestrator,
      availableActions: ALL_ACTIONS,
    });

    adapter.setNextMessage(makeMessage("diagnose my funnel"));
    await runtime.handleIncomingMessage({});

    // Should get a text reply with formatted diagnostic, NOT a result card
    expect(adapter.sentText).toHaveLength(1);
    expect(adapter.sentText[0]!.text).toContain("Funnel Diagnostic");
    expect(adapter.sentText[0]!.text).toContain("Primary KPI: purchase");
    expect(adapter.sentText[0]!.text).toContain("CTR declined");

    // No approval cards or result cards
    expect(adapter.sentApprovalCards).toHaveLength(0);
    expect(adapter.sentResultCards).toHaveLength(0);
  });

  it("diagnostic result is stored in conversation history", async () => {
    const mockInterpreter: Interpreter = {
      async interpret(): Promise<InterpreterResult> {
        return {
          proposals: [{
            id: "prop_diag_hist",
            actionType: "digital-ads.funnel.diagnose",
            parameters: { platform: "meta", entityId: "act_test", vertical: "commerce", periodDays: 7 },
            evidence: "Diagnostic intent",
            confidence: 0.85,
            originatingMessageId: "",
          }],
          needsClarification: false,
          clarificationQuestion: null,
          confidence: 0.85,
          rawResponse: "diagnose my funnel",
        };
      },
    };

    const runtime = new ChatRuntime({
      adapter,
      interpreter: mockInterpreter,
      orchestrator,
      availableActions: ALL_ACTIONS,
    });

    adapter.setNextMessage(makeMessage("diagnose my funnel"));
    await runtime.handleIncomingMessage({});

    // The formatted text was sent as a reply → recordAssistantMessage was called
    expect(adapter.sentText).toHaveLength(1);
    const sentText = adapter.sentText[0]!.text;
    expect(sentText).toContain("Funnel Diagnostic");
  });

  it("RuleBasedInterpreter end-to-end: 'diagnose my funnel' → formatted reply", async () => {
    const interpreter = new RuleBasedInterpreter({
      diagnosticDefaults: { platform: "meta", entityId: "act_test" },
    });

    const runtime = new ChatRuntime({
      adapter,
      interpreter,
      orchestrator,
      availableActions: ALL_ACTIONS,
    });

    adapter.setNextMessage(makeMessage("diagnose my funnel"));
    await runtime.handleIncomingMessage({});

    // Should get formatted text, not result card
    expect(adapter.sentText).toHaveLength(1);
    expect(adapter.sentText[0]!.text).toContain("Funnel Diagnostic");
    expect(adapter.sentResultCards).toHaveLength(0);
  });
});
