import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSkillMode } from "../skill-mode.js";

const register = vi.fn();

const governanceInstance = { name: "governance" };
const GovernanceHook = vi.fn().mockImplementation(() => governanceInstance);
const claimClassifierInstance = { name: "claim-classifier" };
const ClaimClassifierHook = vi.fn().mockImplementation(() => claimClassifierInstance);

const SkillExecutorImpl = vi.fn().mockImplementation(function (
  this: Record<string, unknown>,
  ...args: unknown[]
) {
  this._constructorArgs = args;
  return this;
});

const tracePersistenceInstance = { name: "trace-persistence" };
const TracePersistenceHook = vi.fn().mockImplementation(() => tracePersistenceInstance);

vi.mock("@switchboard/core/skill-runtime", () => ({
  loadSkill: vi.fn((slug: string) =>
    slug === "mira"
      ? {
          name: "Mira",
          slug: "creative",
          body: "Compose a brief",
          parameters: [],
          tools: [],
          context: [],
          intent: "creative.brief.compose",
        }
      : {
          slug: "alex",
          body: "You are Alex",
          parameters: {},
          tools: ["crm-write"],
        },
  ),
  SkillExecutorImpl,
  GovernanceHook,
  TracePersistenceHook,
  DeterministicSafetyGateHook: vi
    .fn()
    .mockImplementation(() => ({ name: "deterministic-safety-gate" })),
  ClaimClassifierHook,
  PdpaConsentGateHook: vi.fn().mockImplementation(() => ({ name: "pdpa-consent-gate" })),
  WhatsAppWindowGateHook: vi.fn().mockImplementation(() => ({ name: "whatsapp-window-gate" })),
  SimulationPolicyHook: vi.fn().mockImplementation(() => ({ name: "simulation" })),
  AnthropicToolAdapter: vi.fn().mockImplementation(() => ({})),
  BuilderRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    get: vi.fn(),
    slugs: vi.fn(() => []),
  })),
  ContextResolverImpl: vi.fn().mockImplementation(() => ({
    resolve: vi.fn(async () => ({ variables: {}, metadata: [] })),
  })),
  createCrmQueryToolFactory: vi.fn(() => () => ({
    operations: { get: { effectCategory: "read" } },
  })),
  createCrmWriteToolFactory: vi.fn(() => () => ({
    operations: { upsert: { effectCategory: "write" } },
  })),
  createCalendarBookToolFactory: vi.fn(() => () => ({
    operations: { create: { effectCategory: "external_mutation" } },
  })),
  createEscalateToolFactory: vi.fn(() => () => ({
    operations: { owner: { effectCategory: "external_send" } },
  })),
  createDelegateToolFactory: vi.fn(() => () => ({
    operations: { creative_concept: { effectCategory: "propose" } },
  })),
  BookingFailureHandler: vi.fn().mockImplementation(() => ({})),
  alexBuilder: vi.fn(async () => ({})),
  miraBuilder: vi.fn(async () => ({ parameters: {}, injectedPatternIds: [] })),
  createAgentDeploymentGovernanceResolver: vi.fn(() => vi.fn(async () => ({ status: "missing" }))),
  InMemoryGovernancePostureCache: vi.fn().mockImplementation(() => ({
    remember: vi.fn(),
    lastKnown: vi.fn(() => null),
  })),
  loadBannedPhrases: vi.fn(() => []),
  // 1b-2 classifier infrastructure
  createAnthropicClaimClassifier: vi.fn(() => ({ classify: vi.fn() })),
  createSubstantiationResolver: vi.fn(() => ({
    resolve: vi.fn(async () => ({ status: "not_found" })),
  })),
  createInMemoryLRU: vi.fn(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  })),
  loadRegulatoryPublicSources: vi.fn(() => []),
  loadRewriteTemplates: vi.fn(() => []),
  splitSentences: vi.fn((text: string) => [text]),
  renderHandoffTemplate: vi.fn(() => "Handoff message"),
  createScheduleFollowUpToolFactory: vi.fn(() => () => ({
    operations: { schedule: { effectCategory: "write" } },
  })),
  createDepositLinkToolFactory: vi.fn(() => () => ({
    id: "deposit-link",
    operations: { "deposit.issue": { effectCategory: "read" } },
  })),
}));

vi.mock("@switchboard/core/platform", () => ({
  SkillMode: class SkillMode {
    constructor(public config: Record<string, unknown>) {}
  },
  registerSkillIntents: vi.fn(),
}));

vi.mock("@switchboard/core", () => ({
  HandoffPackageAssembler: vi.fn().mockImplementation(() => ({})),
  HandoffNotifier: vi.fn().mockImplementation(() => ({})),
  createConsentService: vi.fn(() => ({
    attachToGovernedInteraction: vi.fn(),
    recordDisclosureShown: vi.fn(),
    recordGrant: vi.fn(),
    recordRevocation: vi.fn(),
    clearConsent: vi.fn(),
  })),
  loadRevocationKeywords: vi.fn(() => []),
  recordGovernanceVerdictMetric: vi.fn(),
  ModelRouter: class ModelRouter {},
}));

vi.mock("@switchboard/core/notifications", () => ({
  NoopNotifier: vi.fn().mockImplementation(() => ({})),
  TelegramApprovalNotifier: vi.fn().mockImplementation(() => ({})),
  CompositeNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../services/notifications/email-escalation-notifier.js", () => ({
  EmailEscalationNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/db", () => ({
  PrismaContactStore: vi.fn().mockImplementation(() => ({})),
  PrismaOpportunityStore: vi.fn().mockImplementation(() => ({
    findActiveByContact: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "opp_1" })),
  })),
  PrismaActivityLogStore: vi.fn().mockImplementation(() => ({})),
  PrismaBookingStore: vi.fn().mockImplementation(() => ({ findById: vi.fn(async () => null) })),
  PrismaHandoffStore: vi.fn().mockImplementation(() => ({})),
  PrismaBusinessFactsStore: vi.fn().mockImplementation(() => ({})),
  PrismaDeploymentStore: vi.fn().mockImplementation(() => ({
    findById: vi.fn(async () => null),
  })),
  PrismaGovernanceVerdictStore: vi.fn().mockImplementation(() => ({
    save: vi.fn(async () => {}),
  })),
  createPrismaApprovedComplianceClaimStore: vi.fn(() => ({
    findApproved: vi.fn(async () => []),
  })),
  createPrismaConsentStore: vi.fn(() => ({
    readOrNull: vi.fn(async () => null),
    setJurisdictionIfNull: vi.fn(),
    setDisclosure: vi.fn(),
    setGrant: vi.fn(),
    setRevocationIfNotRevoked: vi.fn(async () => ({
      wasNewlyRevoked: true,
      existingRevokedAt: null,
    })),
    clearConsentTimestamps: vi.fn(async () => ({
      previousGrantedAt: null,
      previousRevokedAt: null,
    })),
  })),
  createPrismaContactConsentReader: vi.fn(() => ({
    read: vi.fn(async () => null),
  })),
  PrismaExecutionTraceStore: vi.fn().mockImplementation(() => ({
    create: vi.fn(async () => {}),
  })),
  PrismaKnowledgeEntryStore: vi.fn().mockImplementation(() => ({
    findActive: vi.fn(async () => []),
  })),
  PrismaDeploymentMemoryStore: vi.fn().mockImplementation(() => ({
    listHighConfidence: vi.fn(async () => []),
  })),
  PrismaMiraCreativeReadModelReader: vi.fn().mockImplementation(() => ({
    read: vi.fn(async () => ({ jobs: [], counts: {} })),
  })),
  PrismaScheduledFollowUpStore: vi.fn().mockImplementation(() => ({
    findDue: vi.fn(async () => []),
    markSent: vi.fn(async () => {}),
    markSkipped: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  })),
}));

describe("bootstrapSkillMode governance wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANTHROPIC_API_KEY"] = "test-key";
  });

  const buildPrismaClient = () =>
    ({
      $transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => unknown) =>
        fn({
          booking: {
            findMany: vi.fn(async () => []),
            create: vi.fn(async () => ({
              id: "booking_1",
              startsAt: new Date(),
              endsAt: new Date(),
              status: "confirmed",
              calendarEventId: "evt_1",
              timezone: "UTC",
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
            update: vi.fn(),
          },
          escalationRecord: {},
          outboxEvent: { create: vi.fn() },
        }),
      ),
      escalationRecord: { findMany: vi.fn(async () => []) },
      organizationConfig: {
        // Bootstrap has no orgId; LocalCalendarProvider path now requires orgId.
        // Return null so resolveCalendarProvider falls through to NoopCalendarProvider.
        findFirst: vi.fn(async () => null),
      },
      booking: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "booking_1" })),
        update: vi.fn(async () => ({ id: "booking_1" })),
      },
      conversationState: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      conversationThread: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
      },
    }) as never;

  it("constructs GovernanceHook and passes it to SkillExecutorImpl", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // GovernanceHook was constructed with the tools map (once for main, once for simulation)
    expect(GovernanceHook).toHaveBeenCalledTimes(2);
    const hookArg = GovernanceHook.mock.calls[0]![0];
    expect(hookArg).toBeInstanceOf(Map);

    // SkillExecutorImpl was constructed (main, simulation, compose)
    expect(SkillExecutorImpl).toHaveBeenCalledTimes(3);

    // Slice-4 compose executor (calls[2]): zero tools, zero hooks, no router,
    // its own TracePersistenceHook at the isolated 8th slot (spec 3.4).
    const composeArgs = SkillExecutorImpl.mock.calls[2]!;
    expect((composeArgs[1] as Map<string, unknown>).size).toBe(0);
    expect(composeArgs[2]).toBeUndefined();
    expect(composeArgs[3]).toEqual([]);
    expect(composeArgs[7]).toBe(tracePersistenceInstance);

    // The GovernanceHook instance was passed to SkillExecutorImpl
    const executorArgs = SkillExecutorImpl.mock.calls[0]!;
    const hooksArg = executorArgs.find(
      (arg) => Array.isArray(arg) && arg.some((h) => h === governanceInstance),
    );
    expect(hooksArg).toBeDefined();
  });

  it("wires a ModelRouter into the production executor (arg-3) only when the flag is enabled", async () => {
    process.env["ALEX_MODEL_ROUTER_ENABLED"] = "true";
    try {
      await bootstrapSkillMode({
        prismaClient: buildPrismaClient(),
        intentRegistry: {} as never,
        modeRegistry: { register } as never,
        logger: { info: vi.fn(), error: vi.fn() },
      });

      // calls[0] = production executor, calls[1] = simulation executor.
      // The 3rd positional arg (index 2) is the `router`. Guards the original
      // "router is always undefined" bug from silently regressing: production
      // gets a router when the flag is on, simulation stays on the fallback.
      expect(SkillExecutorImpl.mock.calls[0]![2]).toBeDefined();
      expect(SkillExecutorImpl.mock.calls[1]![2]).toBeUndefined();
      expect(SkillExecutorImpl.mock.calls[2]![2]).toBeUndefined();
    } finally {
      delete process.env["ALEX_MODEL_ROUTER_ENABLED"];
    }
  });

  it("leaves the production executor router undefined when the flag is off", async () => {
    delete process.env["ALEX_MODEL_ROUTER_ENABLED"];
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(SkillExecutorImpl.mock.calls[0]![2]).toBeUndefined();
  });

  it("registers ClaimClassifierHook immediately after DeterministicSafetyGateHook in hook chain", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // ClaimClassifierHook was constructed once (shared with simulation)
    expect(ClaimClassifierHook).toHaveBeenCalledTimes(1);

    // Main executor hook chain: [GovernanceHook, safetyGateHook, claimClassifierHook]
    const mainExecutorArgs = SkillExecutorImpl.mock.calls[0]!;
    const mainHooks = mainExecutorArgs.find(
      (arg) =>
        Array.isArray(arg) &&
        arg.some((h: { name?: string }) => h.name === "deterministic-safety-gate"),
    ) as Array<{ name?: string }> | undefined;
    expect(mainHooks).toBeDefined();

    const deterministicIdx = mainHooks!.findIndex((h) => h.name === "deterministic-safety-gate");
    const classifierIdx = mainHooks!.findIndex((h) => h === claimClassifierInstance);
    expect(deterministicIdx).toBeGreaterThanOrEqual(0);
    expect(classifierIdx).toBeGreaterThanOrEqual(0);
    // ClaimClassifierHook MUST run IMMEDIATELY after DeterministicSafetyGateHook —
    // spec §7 requires the two governance gates be adjacent so no other hook can
    // mutate `result.response` between them.
    expect(classifierIdx).toBe(deterministicIdx + 1);
  });

  it("wires the TracePersistenceHook into the production executor (arg-8) but not the simulation executor", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // The telemetry recorder is constructed exactly once (production only) and
    // passed as the 8th positional arg (index 7) — the isolated `executionTraceHook`
    // template, NOT a member of the governance `hooks` array. The simulation
    // executor (calls[1]) omits it so eval/sim runs carry no trace hook.
    expect(TracePersistenceHook).toHaveBeenCalledTimes(2);
    expect(TracePersistenceHook.mock.calls[0]![1]).toEqual({ trigger: "chat_message" });
    expect(TracePersistenceHook.mock.calls[1]![1]).toEqual({ trigger: "brief_compose" });
    expect(SkillExecutorImpl.mock.calls[0]![7]).toBe(tracePersistenceInstance);
    expect(SkillExecutorImpl.mock.calls[1]![7]).toBeUndefined();
    expect(SkillExecutorImpl.mock.calls[2]![7]).toBe(tracePersistenceInstance);

    // Guard the landmine: the recorder must NOT leak into the governance hooks
    // array (arg index 3) — that array is what runAfterSkillHooks would activate.
    const prodHooks = SkillExecutorImpl.mock.calls[0]![3] as Array<{ name?: string }>;
    expect(prodHooks.some((h) => h.name === "trace-persistence")).toBe(false);
  });

  it("registers two skills under distinct slugs and maps the compose executor by the runtime slug", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // SkillMode is mocked as a config-capturing class; the registered instance
    // carries the bootstrap's exact wiring.
    const skillModeInstance = register.mock.calls.find(
      (c) => (c[0] as { config?: { skillsBySlug?: Map<string, unknown> } }).config?.skillsBySlug,
    )?.[0] as {
      config: {
        skillsBySlug: Map<string, unknown>;
        executorBySlug: Map<string, unknown>;
        stores: Record<string, unknown>;
      };
    };
    expect(skillModeInstance).toBeDefined();
    const { config } = skillModeInstance;
    // Directory "mira" loads with frontmatter slug "creative" (the runtime
    // identity = deployment skillSlug); a collision with alex must throw at boot.
    expect(config.skillsBySlug.size).toBe(2);
    expect(config.skillsBySlug.has("alex")).toBe(true);
    expect(config.skillsBySlug.has("creative")).toBe(true);
    // The compose executor is keyed by the RUNTIME slug, not the directory name.
    expect(config.executorBySlug.get("creative")).toBeDefined();
    expect(config.executorBySlug.get("mira")).toBeUndefined();
    // The slice-4 readers ride SkillMode stores.
    expect(config.stores["deploymentMemoryReader"]).toBeDefined();
    expect(config.stores["miraReadModelReader"]).toBeDefined();
  });

  it("registers the deposit-link tool in both maps when a paymentPortFactory is provided", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
      paymentPortFactory: vi.fn() as never,
    });
    const mainArgs = SkillExecutorImpl.mock.calls[0]!;
    expect((mainArgs[1] as Map<string, unknown>).has("deposit-link")).toBe(true);
    expect((mainArgs[5] as Map<string, unknown>).has("deposit-link")).toBe(true);

    // Excluded from the simulation executor (calls[1]): read+idempotent is NOT
    // blocked by SimulationPolicyHook, but a live Stripe issue is a real side effect.
    const simArgs = SkillExecutorImpl.mock.calls[1]!;
    expect((simArgs[1] as Map<string, unknown>).has("deposit-link")).toBe(false);
    expect((simArgs[5] as Map<string, unknown>).has("deposit-link")).toBe(false);
  });

  it("omits the deposit-link tool when no paymentPortFactory is provided (fail-closed)", async () => {
    await bootstrapSkillMode({
      prismaClient: buildPrismaClient(),
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const mainArgs = SkillExecutorImpl.mock.calls[0]!;
    expect((mainArgs[1] as Map<string, unknown>).has("deposit-link")).toBe(false);
    expect((mainArgs[5] as Map<string, unknown>).has("deposit-link")).toBe(false);
  });
});
