import type Anthropic from "@anthropic-ai/sdk";
import { loadSkill, SkillExecutorImpl } from "@switchboard/core/skill-runtime";
import { createTemp0Adapter, type Temp0Adapter } from "../alex-conversation/temp0-adapter.js";
import type { MiraScenario, MiraComposeGradeInput } from "./schema.js";

// Production wires NO model router for the compose executor (spec 3.4), so the
// adapter default (claude-sonnet-4-6) applies — pin it here for a faithful drive.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const ORG_ID = "eval-org";
const DEPLOYMENT_ID = "eval-deployment";

const DEFAULT_SKILLS_DIR = new URL("../../skills", import.meta.url).pathname;

/**
 * The minimal user turn the harness supplies to drive Mira's compose live.
 *
 * F1 (the empty-messages defect this harness surfaces): production's compose submit
 * carries NO conversation, so skill-mode passes `messages: []` to the executor, which
 * forwards `[]` to `client.messages.create` — a LIVE Anthropic call REJECTS an empty
 * messages array (≥1 message required). It is masked today only because
 * MIRA_SELF_BRIEF_ENABLED is dark and the compose has never run live. All of Mira's
 * context lives in the SYSTEM prompt (the rendered SKILL.md), so this turn is a
 * content-free "go" signal — exactly the turn the production fix must add. The harness
 * surfaces the defect (README + report + plan row); it does not paper over it silently.
 */
export const COMPOSE_USER_TURN =
  "Produce your compose decision now as the single JSON object specified in your instructions.";

export interface RunMiraComposeDeps {
  /** Offline: a fake adapter driving the REAL executor (no Anthropic client, no key). */
  adapter?: Temp0Adapter;
  /** Live: an Anthropic client wrapped in the temp-0 adapter (required when `adapter` is omitted). */
  anthropicClient?: Anthropic;
  /** Live model id. Defaults to claude-sonnet-4-6 (the production compose default). */
  model?: string;
  /** Override the skills dir (tests). Defaults to the repo skill pack. */
  skillsDir?: string;
}

/**
 * Drive Mira's REAL compose generation over one golden scenario and normalize the
 * result for the grader. Faithful to the production compose path: the real
 * skills/mira/SKILL.md body, rendered with the scenario parameters, run through a
 * zero-tool / zero-hook SkillExecutorImpl (the production compose executor shape,
 * spec 3.4). Offline tests inject a fake `adapter`; the live leg passes an
 * `anthropicClient`.
 *
 * Any throw (provider rejection, executor failure) is captured as `crashed: true`
 * rather than aborting the run — the graceful-degradation signal the grader checks.
 */
export async function runMiraCompose(
  scenario: MiraScenario,
  deps: RunMiraComposeDeps,
): Promise<MiraComposeGradeInput> {
  const skill = loadSkill("mira", deps.skillsDir ?? DEFAULT_SKILLS_DIR);
  const adapter =
    deps.adapter ??
    createTemp0Adapter(
      requireClient(deps.anthropicClient),
      deps.model ?? DEFAULT_MODEL,
      DEFAULT_MAX_TOKENS,
    );

  // Zero tools, zero hooks, no router — the production compose executor (spec 3.4).
  const executor = new SkillExecutorImpl(adapter, new Map(), undefined, []);

  try {
    const result = await executor.execute({
      skill,
      parameters: scenario.params,
      // F1: a non-empty user turn (COMPOSE_USER_TURN) so the live API call is valid.
      messages: [{ role: "user", content: COMPOSE_USER_TURN }],
      deploymentId: DEPLOYMENT_ID,
      orgId: ORG_ID,
      trustScore: 0,
      trustLevel: "autonomous",
      sessionId: `eval-mira-${scenario.id}`,
    });
    return {
      rawResponse: result.response,
      // The executor's strip side-channels: a set value means Mira bled a cross-agent tag.
      intentClass: result.intentClass ?? null,
      qualificationSignals: result.qualificationSignals,
      crashed: false,
    };
  } catch {
    return { rawResponse: "", crashed: true };
  }
}

function requireClient(client: Anthropic | undefined): Anthropic {
  if (!client) {
    throw new Error(
      "runMiraCompose: either `adapter` (offline) or `anthropicClient` (live) must be provided",
    );
  }
  return client;
}
