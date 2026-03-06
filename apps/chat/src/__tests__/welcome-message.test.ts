import { describe, it, expect, beforeEach } from "vitest";
import { ChatRuntime } from "../runtime.js";
import type {
  ChannelAdapter,
  ApprovalCardPayload,
  ResultCardPayload,
} from "../adapters/adapter.js";
import type { IncomingMessage } from "@switchboard/schemas";
import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
} from "@switchboard/core";
import type { StorageContext, ResolvedSkin } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec, SkinManifest } from "@switchboard/schemas";
import { deleteThread } from "../conversation/threads.js";
import { composeWelcomeMessage } from "../composer/reply.js";

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
    id: `msg_${Date.now()}_${Math.random()}`,
    channel: "telegram",
    channelMessageId: "123",
    threadId: "welcome_thread",
    principalId: "user_welcome",
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
    id: "spec_welcome",
    principalId: "user_welcome",
    organizationId: null,
    name: "Welcome Test User",
    description: "Test identity spec for welcome tests",
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
    delegatedApprovers: ["user_welcome"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeResolvedSkin(overrides?: Partial<SkinManifest>): ResolvedSkin {
  const manifest: SkinManifest = {
    id: "test-skin",
    name: "Test Clinic",
    version: "1.0.0",
    description: "Test skin",
    tools: { include: ["customer-engagement.*"] },
    governance: { profile: "observe" },
    language: {
      locale: "en",
      welcomeMessage:
        "Welcome to {{businessName}}! I'm your assistant.\n\nType 'help' to see what I can do!",
    },
    requiredCartridges: ["customer-engagement"],
    ...overrides,
  };

  return {
    manifest,
    toolFilter: { include: ["customer-engagement.*"], exclude: [], aliases: {} },
    tools: [],
    governancePreset: {
      riskTolerance: {
        none: "none",
        low: "none",
        medium: "none",
        high: "none",
        critical: "none",
      },
      spendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
      forbiddenBehaviors: [],
      trustBehaviors: [],
    },
    governance: manifest.governance,
    language: manifest.language,
    playbooks: [],
    primaryChannel: null,
    requiredCartridges: ["customer-engagement"],
    config: {},
  };
}

// ---------------------------------------------------------------------------
// Unit tests for composeWelcomeMessage
// ---------------------------------------------------------------------------
describe("composeWelcomeMessage", () => {
  it("uses skin template with businessName substitution", () => {
    const skin = makeResolvedSkin();
    const result = composeWelcomeMessage(skin, "Bright Smile Dental");
    expect(result).toContain("Welcome to Bright Smile Dental!");
    expect(result).toContain("Type 'help'");
  });

  it("uses skin manifest name when businessName is undefined", () => {
    const skin = makeResolvedSkin();
    const result = composeWelcomeMessage(skin);
    expect(result).toContain("Welcome to Test Clinic!");
  });

  it('falls back to "our team" when no businessName and no manifest name', () => {
    const skin = makeResolvedSkin();
    // Override manifest name to empty-ish — but SkinManifest requires min(1), so test via a
    // scenario where we pass an explicit empty businessName override
    // Actually, test the case where both are missing: null skin
    const result = composeWelcomeMessage(
      { ...skin, manifest: { ...skin.manifest, name: "" } as SkinManifest },
      undefined,
    );
    // With an empty manifest name, it should fall back to "our team"
    expect(result).toContain("our team");
  });

  it("returns default welcome when no skin is provided", () => {
    const result = composeWelcomeMessage(null, "My Business", [
      "digital-ads.campaign.pause",
      "digital-ads.campaign.resume",
    ]);
    expect(result).toContain("Welcome to My Business!");
    expect(result).toContain("manage campaigns");
    expect(result).toContain("Type 'help'");
  });

  it("returns default welcome without businessName", () => {
    const result = composeWelcomeMessage(null, undefined, []);
    expect(result).toContain("Welcome!");
    expect(result).toContain("I'm here to help");
  });

  it("includes customer-engagement capabilities in default welcome", () => {
    const result = composeWelcomeMessage(null, undefined, ["customer-engagement.appointment.book"]);
    expect(result).toContain("appointments");
  });

  it("replaces all occurrences of {{businessName}}", () => {
    const skin = makeResolvedSkin({
      language: {
        locale: "en",
        welcomeMessage: "{{businessName}} welcomes you to {{businessName}}!",
      },
    });
    const result = composeWelcomeMessage(skin, "Acme Corp");
    expect(result).toBe("Acme Corp welcomes you to Acme Corp!");
  });
});

// ---------------------------------------------------------------------------
// Integration tests for welcome message in ChatRuntime
// ---------------------------------------------------------------------------
describe("ChatRuntime Welcome Message", () => {
  let adapter: MockAdapter;
  let storage: StorageContext;
  let orchestrator: LifecycleOrchestrator;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    adapter = new MockAdapter();
    storage = createInMemoryStorage();
    const ledgerStorage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(ledgerStorage);
    const guardrailState = createGuardrailState();

    cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
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
      undoRecipe: null,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cartridge as any).resolveEntity = async (inputRef: string, entityType: string) => ({
      id: `resolve_${Date.now()}`,
      inputRef,
      resolvedType: entityType,
      resolvedId: "camp_123",
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
      id: "user_welcome",
      type: "user",
      name: "Welcome Test User",
      organizationId: null,
      roles: ["requester", "approver"],
    });

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
      selfApprovalAllowed: true,
      routingConfig: {
        defaultApprovers: ["user_welcome"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny" as const,
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
      },
    });

    deleteThread("welcome_thread");
  });

  it("sends welcome message on first message of new conversation", async () => {
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
    });

    adapter.setNextMessage(makeMessage("hi"));
    await runtime.handleIncomingMessage({});

    // First message should be a welcome (not "I didn't catch that")
    expect(adapter.sentText.length).toBeGreaterThanOrEqual(1);
    expect(adapter.sentText[0]?.text).toContain("Welcome!");
    // Should NOT contain the uncertain reply
    const hasUncertain = adapter.sentText.some((t) => t.text.includes("didn't quite catch that"));
    expect(hasUncertain).toBe(false);
  });

  it("uses skin-configured welcome message", async () => {
    const skin = makeResolvedSkin();
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["customer-engagement.appointment.book"],
      resolvedSkin: skin,
    });

    adapter.setNextMessage(makeMessage("hello"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText.length).toBeGreaterThanOrEqual(1);
    // Should use skin template with manifest name fallback
    expect(adapter.sentText[0]?.text).toContain("Welcome to Test Clinic!");
  });

  it("substitutes {{businessName}} from resolved profile", async () => {
    const skin = makeResolvedSkin();
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["customer-engagement.appointment.book"],
      resolvedSkin: skin,
      resolvedProfile: {
        profile: {
          business: { name: "Bright Smile Dental", type: "dental" },
          services: { catalog: [] },
        },
      } as never,
    });

    adapter.setNextMessage(makeMessage("hey"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText[0]?.text).toContain("Welcome to Bright Smile Dental!");
  });

  it("suppresses 'I didn't catch that' after welcome for greeting", async () => {
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
    });

    adapter.setNextMessage(makeMessage("hi"));
    await runtime.handleIncomingMessage({});

    // Only welcome should be sent, not "I didn't catch that"
    const texts = adapter.sentText.map((t) => t.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Welcome!");
    expect(texts[0]).not.toContain("didn't quite catch that");
  });

  it("processes actionable first messages alongside welcome", async () => {
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      storage,
      availableActions: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
    });

    adapter.setNextMessage(makeMessage("pause Summer Sale"));
    await runtime.handleIncomingMessage({});

    // Welcome should be sent
    expect(adapter.sentText.some((t) => t.text.includes("Welcome"))).toBe(true);
    // AND the proposal should be processed (approval card or result card)
    const hasProposalResponse =
      adapter.sentApprovalCards.length > 0 || adapter.sentResultCards.length > 0;
    expect(hasProposalResponse).toBe(true);
  });

  it("does not re-send welcome on second message in same thread", async () => {
    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
    });

    // First message — welcome sent
    adapter.setNextMessage(makeMessage("hi"));
    await runtime.handleIncomingMessage({});
    const firstMessageCount = adapter.sentText.length;
    expect(adapter.sentText[0]?.text).toContain("Welcome");

    // Second message — no welcome
    adapter.reset();
    adapter.setNextMessage(makeMessage("hello again"));
    await runtime.handleIncomingMessage({});

    // Should get "I didn't catch that" (not welcome)
    const hasWelcome = adapter.sentText.some((t) => t.text.includes("Welcome"));
    expect(hasWelcome).toBe(false);
    expect(firstMessageCount).toBeGreaterThan(0);
  });

  it("applies banned-phrase filter to welcome message", async () => {
    const skin = makeResolvedSkin({
      language: {
        locale: "en",
        welcomeMessage: "Welcome! We guarantee guaranteed results for you!",
      },
    });
    // Set banned phrases on resolved skin config (not manifest config)
    skin.config = { bannedPhrases: ["guaranteed results"] };

    const runtime = new ChatRuntime({
      adapter,
      interpreter: new RuleBasedInterpreter(),
      orchestrator,
      availableActions: ["customer-engagement.appointment.book"],
      resolvedSkin: skin,
    });

    adapter.setNextMessage(makeMessage("hi"));
    await runtime.handleIncomingMessage({});

    expect(adapter.sentText.length).toBeGreaterThanOrEqual(1);
    // The banned phrase should be redacted
    expect(adapter.sentText[0]?.text).not.toContain("guaranteed results");
  });
});
