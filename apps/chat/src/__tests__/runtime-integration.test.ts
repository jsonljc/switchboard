import { describe, it, expect, beforeEach } from "vitest";
import { ChatRuntime } from "../runtime.js";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
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

function makeMessage(text: string, overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: `msg_${Date.now()}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: "thread_1",
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

describe("ChatRuntime Integration", () => {
  let adapter: MockAdapter;
  let storage: StorageContext;
  let orchestrator: LifecycleOrchestrator;
  let runtime: ChatRuntime;
  let cartridge: TestCartridge;
  let ledgerStorage: InMemoryLedgerStorage;

  beforeEach(async () => {
    adapter = new MockAdapter();
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

    cartridge = new TestCartridge(createTestManifest({ id: "ads-spend" }));

    // Set up cartridge to return high base risk, which computes to
    // "medium" risk category (score ~56), triggering standard approval
    cartridge.onRiskInput(() => ({
      baseRisk: "high" as const,
      exposure: { dollarsAtRisk: 500, blastRadius: 1 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));

    cartridge.onExecute((_actionType, params) => ({
      success: true,
      summary: `Campaign ${(params["campaignId"] as string) ?? "unknown"} paused`,
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

    // Add resolveEntity to cartridge
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

    // Seed identity
    await storage.identity.saveSpec(makeIdentitySpec());

    // Save principal record for test user (needed for approval authorization)
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

    runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["ads.campaign.pause", "ads.campaign.resume", "ads.budget.adjust"],
    });

    // Clean up thread state
    deleteThread("thread_1");
  });

  it("should send approval card for pause command", async () => {
    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    // Should have sent an approval card
    expect(adapter.sentApprovalCards).toHaveLength(1);
    expect(adapter.sentApprovalCards[0]?.card.buttons.length).toBeGreaterThan(0);
    expect(adapter.sentApprovalCards[0]?.card.summary).toContain("ads");
    expect(adapter.sentApprovalCards[0]?.card.summary).toContain("pause");
  });

  it("should execute after approval button tap", async () => {
    // Step 1: Send pause command → get approval card
    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentApprovalCards).toHaveLength(1);
    const approvalCard = adapter.sentApprovalCards[0]!.card;
    const approveButton = approvalCard.buttons.find((b) => b.label === "Approve");
    expect(approveButton).toBeDefined();

    // Step 2: Simulate button tap
    adapter.reset();
    adapter.setNextMessage(makeMessage(approveButton!.callbackData));
    await runtime.handleIncomingMessage({});

    // Should receive a result card
    expect(adapter.sentResultCards).toHaveLength(1);
    expect(adapter.sentResultCards[0]?.card.success).toBe(true);
  });

  it("should handle undo after execution", async () => {
    // Step 1: Pause → approval card
    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});
    const approveBtn = adapter.sentApprovalCards[0]!.card.buttons.find(
      (b) => b.label === "Approve",
    );

    // Step 2: Approve → result card
    adapter.reset();
    adapter.setNextMessage(makeMessage(approveBtn!.callbackData));
    await runtime.handleIncomingMessage({});
    expect(adapter.sentResultCards).toHaveLength(1);

    // Step 3: Undo → should trigger undo flow
    adapter.reset();
    adapter.setNextMessage(makeMessage("undo"));
    await runtime.handleIncomingMessage({});

    // The undo creates a new proposal which also needs approval (medium risk)
    // So we should get another approval card
    expect(
      adapter.sentApprovalCards.length + adapter.sentResultCards.length,
    ).toBeGreaterThan(0);
  });

  it("should send denial message for forbidden action", async () => {
    // Update identity to forbid this action
    await storage.identity.saveSpec(
      makeIdentitySpec({
        forbiddenBehaviors: ["ads.campaign.pause"],
      }),
    );

    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    // Should receive a text denial
    expect(adapter.sentText.length).toBeGreaterThan(0);
    const denialMsg = adapter.sentText.find((t) => t.text.includes("Blocked"));
    expect(denialMsg).toBeDefined();
  });

  it("should send clarification for ambiguous entity", async () => {
    // Set up resolver to return ambiguous result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cartridge as any).resolveEntity = async (
      inputRef: string,
      entityType: string,
    ) => ({
      id: `resolve_${Date.now()}`,
      inputRef,
      resolvedType: entityType,
      resolvedId: "camp_1",
      resolvedName: inputRef,
      confidence: 0.5,
      alternatives: [
        { id: "camp_1", name: "Summer Sale 2024", score: 0.5 },
        { id: "camp_2", name: "Summer Sale 2025", score: 0.5 },
      ],
      status: "ambiguous" as const,
    });

    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    // Should receive a clarification question
    expect(adapter.sentText.length).toBeGreaterThan(0);
    const clarification = adapter.sentText.find((t) => t.text.includes("Which"));
    expect(clarification).toBeDefined();
  });

  it("should handle help command", async () => {
    adapter.setNextMessage(makeMessage("help"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText).toHaveLength(1);
    expect(adapter.sentText[0]?.text).toContain("Available actions");
  });

  it("should handle unknown intent", async () => {
    adapter.setNextMessage(makeMessage("what is the weather"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText.length).toBeGreaterThan(0);
    expect(adapter.sentText[0]?.text).toContain("not sure");
  });

  it("should handle rejection", async () => {
    // Step 1: Pause → approval card
    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    const rejectBtn = adapter.sentApprovalCards[0]!.card.buttons.find(
      (b) => b.label === "Reject",
    );
    expect(rejectBtn).toBeDefined();

    // Step 2: Reject
    adapter.reset();
    adapter.setNextMessage(makeMessage(rejectBtn!.callbackData));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText.length).toBeGreaterThan(0);
    expect(adapter.sentText[0]?.text).toContain("rejected");
  });

  it("full vertical: message → propose → approve → execute → audit trail", async () => {
    // 1. Send a command
    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    // 2. Verify approval card sent
    expect(adapter.sentApprovalCards).toHaveLength(1);
    const approveBtn = adapter.sentApprovalCards[0]!.card.buttons.find(
      (b) => b.label === "Approve",
    );
    expect(approveBtn).toBeDefined();

    // 3. Tap approve
    adapter.reset();
    adapter.setNextMessage(makeMessage(approveBtn!.callbackData));
    await runtime.handleIncomingMessage({});

    // 4. Verify execution result
    expect(adapter.sentResultCards).toHaveLength(1);
    expect(adapter.sentResultCards[0]?.card.success).toBe(true);

    // 5. Verify audit trail
    const allEntries = ledgerStorage.getAll();

    // Should have at minimum: action.proposed, action.approved, action.executing, action.executed
    const eventTypes = allEntries.map((e) => e.eventType);
    expect(eventTypes).toContain("action.proposed");
    expect(eventTypes).toContain("action.approved");
    expect(eventTypes).toContain("action.executing");
    expect(eventTypes).toContain("action.executed");

    // 6. Verify hash chain integrity
    const auditLedger = new AuditLedger(ledgerStorage);
    const chainResult = await auditLedger.verifyChain(allEntries);
    expect(chainResult.valid).toBe(true);

    // 7. Verify deep integrity (hash recomputation)
    const deepResult = await auditLedger.deepVerify(allEntries);
    expect(deepResult.valid).toBe(true);
    expect(deepResult.hashMismatches).toHaveLength(0);
  });
});
