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

vi.mock("@switchboard/core/skill-runtime", () => ({
  loadSkill: vi.fn(() => ({
    slug: "alex",
    body: "You are Alex",
    parameters: {},
    tools: ["crm-write"],
  })),
  SkillExecutorImpl,
  GovernanceHook,
  DeterministicSafetyGateHook: vi
    .fn()
    .mockImplementation(() => ({ name: "deterministic-safety-gate" })),
  ClaimClassifierHook,
  SimulationPolicyHook: vi.fn().mockImplementation(() => ({ name: "simulation" })),
  AnthropicToolCallingAdapter: vi.fn().mockImplementation(() => ({})),
  BuilderRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    get: vi.fn(),
    slugs: vi.fn(() => []),
  })),
  createCrmQueryTool: vi.fn(() => ({ operations: { get: { effectCategory: "read" } } })),
  createCrmWriteToolFactory: vi.fn(() => () => ({
    operations: { upsert: { effectCategory: "write" } },
  })),
  createCalendarBookToolFactory: vi.fn(() => () => ({
    operations: { create: { effectCategory: "external_mutation" } },
  })),
  createEscalateToolFactory: vi.fn(() => () => ({
    operations: { owner: { effectCategory: "external_send" } },
  })),
  BookingFailureHandler: vi.fn().mockImplementation(() => ({})),
  alexBuilder: vi.fn(async () => ({})),
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

    // SkillExecutorImpl was constructed (once for main, once for simulation)
    expect(SkillExecutorImpl).toHaveBeenCalledTimes(2);

    // The GovernanceHook instance was passed to SkillExecutorImpl
    const executorArgs = SkillExecutorImpl.mock.calls[0]!;
    const hooksArg = executorArgs.find(
      (arg) => Array.isArray(arg) && arg.some((h) => h === governanceInstance),
    );
    expect(hooksArg).toBeDefined();
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
});
