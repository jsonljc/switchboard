import type Anthropic from "@anthropic-ai/sdk";
import {
  ContextResolverImpl,
  SkillExecutorImpl,
  alexBuilder,
  loadSkill,
} from "@switchboard/core/skill-runtime";
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillTool,
} from "@switchboard/core/skill-runtime";
import { resolvePersona } from "@switchboard/schemas";
import { dirname, join, parse } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ConversationFixture } from "./schema.js";
import { createMockTools, type RecordedToolCall } from "./mock-tools.js";
import {
  createBusinessFactsStore,
  createStubBusinessFacts,
  createStubContextStore,
} from "./stub-context-store.js";
import { createTemp0Adapter } from "./temp0-adapter.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const ORG_ID = "eval-org";
const DEPLOYMENT_ID = "eval-deployment";
const CONTACT_ID = "eval-contact";

/**
 * Minimal structural shape of `SkillExecutor` (one `execute` method). Used so
 * tests can inject a fake executor without importing the interface.
 */
export interface ExecutorLike {
  execute(params: SkillExecutionParams): Promise<SkillExecutionResult>;
}

export interface RunConversationDeps {
  /**
   * Pre-built executor. When provided it is used as-is and NO Anthropic client
   * is constructed — this is the test seam (inject a fake executor to assert the
   * drive logic offline). When omitted, an `anthropicClient` is required and a
   * real temp-0 + mock-tools executor is assembled.
   */
  executor?: ExecutorLike;
  /**
   * Anthropic client. Required when `executor` is omitted. The orchestrator
   * (Task 6) constructs this from `ANTHROPIC_API_KEY`; this module never reads
   * the env key itself.
   */
  anthropicClient?: Anthropic;
  /** Concrete model id for the temp-0 adapter. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Max output tokens per turn. Defaults to 1024. */
  maxTokens?: number;
  /** Override the medspa references dir (tests). Defaults to the repo skill pack. */
  refsDir?: string;
  /** Override the skills dir for `loadSkill`. Defaults to the repo `skills/` dir. */
  skillsDir?: string;
}

/** One captured Alex turn for downstream grading. */
export interface CapturedAlexTurn {
  /** Index of this alex turn within `fixture.turns`. */
  gradeIndex: number;
  /** Alex's real reply text (post intent/sidecar stripping). */
  alexResponse: string;
  /** Full executor result (tool calls, token usage, trace). */
  result: SkillExecutionResult;
}

export interface RunConversationOutcome {
  alexTurns: CapturedAlexTurn[];
  /** Every mock tool call recorded across the whole conversation, in order. */
  toolCalls: RecordedToolCall[];
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== parse(dir).root) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    `run-conversation: could not locate repo root (pnpm-workspace.yaml) from ${start}`,
  );
}

export function defaultSkillsDir(): string {
  return join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "skills");
}

/**
 * Build the raw inputConfig an operator/seed stores on
 * `AgentDeployment.inputConfig`. Resolving it through the PRODUCTION
 * `resolvePersona` (the same path skill-mode.ts uses) is behavior-equivalent to
 * the previous hand-built persona: alexBuilder reads only businessName / tone /
 * the three criteria / bookingLink / customInstructions, and `resolvePersona`
 * preserves the record-shaped criteria verbatim.
 */
function buildInputConfig(fixture: ConversationFixture): Record<string, unknown> {
  return {
    businessName: "Acme Medspa",
    tone: "consultative",
    qualificationCriteria: {
      treatmentInterest: "Which treatment or concern brought them in",
      timeline: "How soon they want to start",
    },
    disqualificationCriteria: {
      outOfArea: "Lead is not reachable at any clinic location",
    },
    escalationRules: {
      medicalAdvice: "Escalate any request for diagnosis or medical advice",
      pricingDispute: "Escalate hard pricing negotiations",
    },
    bookingLink: "https://example.com/book",
    customInstructions: `Locale: ${fixture.locale}. Keep replies short and WhatsApp-native.`,
  };
}

/**
 * Resolve Alex's runtime parameters deterministically (no network, no DB),
 * faithfully mirroring the production live path (apps/api/src/bootstrap/skill-mode.ts):
 *   1. `resolvePersona(inputConfig)` -> ctx.persona (the real schemas function).
 *   2. `alexBuilder` (with the REAL PrismaBusinessFactsStore over a mock Prisma)
 *      OWNS BUSINESS_FACTS: present facts render; absent/malformed -> "".
 *   3. `ContextResolverImpl` gets the knowledge store ONLY and resolves the
 *      business-facts-FILTERED requirements (LOAD-BEARING mirror of
 *      packages/core/src/platform/modes/skill-mode.ts:150-153) -> PLAYBOOK /
 *      QUALIFICATION / CLAIM_BOUNDARIES / POLICY.
 *   4. merge `{ ...builderParams, ...contextVars }` (no BUSINESS_FACTS collision).
 *
 * Exported so the faithfulness gate (live-path-faithfulness.test.ts) can drive the
 * real seam with operator / absent facts.
 */
export async function resolveParameters(
  skill: SkillDefinition,
  fixture: ConversationFixture,
  refsDir?: string,
): Promise<Record<string, unknown>> {
  const persona = resolvePersona(buildInputConfig(fixture));
  if (!persona) {
    throw new Error(
      "run-conversation: resolvePersona returned undefined (businessName missing or inputConfig invalid)",
    );
  }

  const config = fixture.businessFacts === "absent" ? null : createStubBusinessFacts();
  const businessFactsStore = createBusinessFactsStore(config);

  // Stub the builder's other stores. A pre-existing active opportunity is returned
  // so the builder skips its auto-create branch (which needs a contactStore.create).
  const builderStores = {
    opportunityStore: {
      findActiveByContact: async (_orgId: string, _contactId: string) => [
        {
          id: "eval-opportunity",
          stage: "interested",
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
        },
      ],
    },
    contactStore: {
      findById: async (_orgId: string, _contactId: string) => ({
        id: CONTACT_ID,
        name: null,
        phone: null,
      }),
    },
    activityStore: {
      listByDeployment: async (
        _orgId: string,
        _deploymentId: string,
        _opts: { limit: number },
      ) => [],
    },
    businessFactsStore,
  };

  const ctx = { persona } as unknown as Parameters<typeof alexBuilder>[0];

  const builderResult = await alexBuilder(
    ctx,
    {
      deploymentId: DEPLOYMENT_ID,
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      channel: "whatsapp",
    },
    builderStores,
  );

  // Mirror production: the BUILDER owns BUSINESS_FACTS; the resolver must NEVER
  // resolve business-facts (avoids a double-source AND the required-business-facts
  // throw on absent facts). LOAD-BEARING — see skill-mode.ts:150-153.
  const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
  const contextStore = createStubContextStore(refsDir);
  const resolver = new ContextResolverImpl(contextStore);
  const resolved = await resolver.resolve(ORG_ID, knowledgeReqs);

  return { ...builderResult.parameters, ...resolved.variables };
}

/**
 * Drive a real (or injected) Alex through a fixture conversation.
 *
 * Lead turns are FIXED (pushed as `user` messages verbatim). At each `alex`
 * turn the executor runs `execute()` on the conversation-so-far; Alex's real
 * reply is appended as an `assistant` message and carried into the next turn.
 *
 * Determinism: when this module builds the executor it wraps the Anthropic
 * client in a temp-0 adapter (temperature pinned to 0) and uses mock tools with
 * NO governance hooks — no Postgres, no live tool side effects.
 */
export async function runConversation(
  fixture: ConversationFixture,
  deps: RunConversationDeps,
): Promise<RunConversationOutcome> {
  const skillsDir = deps.skillsDir ?? defaultSkillsDir();
  const skill = loadSkill("alex", skillsDir);
  const parameters = await resolveParameters(skill, fixture, deps.refsDir);

  // Mock tools are created even when an executor is injected so the returned
  // `toolCalls` array is always present; an injected fake executor simply won't
  // touch them.
  const mock = createMockTools({ bookingBehavior: fixture.mockBooking });
  const executor = deps.executor ?? buildExecutor(deps, mock.tools);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const alexTurns: CapturedAlexTurn[] = [];

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i]!;
    if (turn.role === "lead") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }

    // alex turn — run the executor on the conversation so far.
    const result = await executor.execute({
      skill,
      parameters,
      messages: [...messages],
      deploymentId: DEPLOYMENT_ID,
      orgId: ORG_ID,
      trustScore: 100,
      trustLevel: "autonomous",
      sessionId: `eval-${fixture.id}`,
    });

    messages.push({ role: "assistant", content: result.response });
    alexTurns.push({ gradeIndex: i, alexResponse: result.response, result });
  }

  return { alexTurns, toolCalls: mock.calls };
}

function buildExecutor(deps: RunConversationDeps, tools: Map<string, SkillTool>): ExecutorLike {
  if (!deps.anthropicClient) {
    throw new Error(
      "runConversation: either `executor` or `anthropicClient` must be provided in deps",
    );
  }
  const adapter = createTemp0Adapter(
    deps.anthropicClient,
    deps.model ?? DEFAULT_MODEL,
    deps.maxTokens ?? DEFAULT_MAX_TOKENS,
  );
  // No router (undefined) and NO hooks ([]) — deterministic, ungoverned offline
  // run. The temp-0 adapter forces temperature:0 despite the absent router.
  return new SkillExecutorImpl(adapter, tools, undefined, []);
}
