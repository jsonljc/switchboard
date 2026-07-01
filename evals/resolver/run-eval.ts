#!/usr/bin/env tsx
import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { loadResolverCases } from "./load-cases.js";
import {
  loadResolverMarkdown,
  extractRouteTargets,
  checkDatasetConsistency,
  truncate,
} from "./resolver-routes.js";
import { isMainPush, appendStepSummary, SKIP_MESSAGE } from "./eval-preflight.js";

/**
 * Resolver-routing eval runner. TWO legs, per this repo's eval idiom.
 *
 *  1) DETERMINISTIC, no-key, BLOCKING - a DRIFT GUARD, not a routing simulator.
 *     There is NO programmatic resolver in this codebase (`.agent/RESOLVER.md` is a
 *     human-read doc), so this leg does NOT measure routing accuracy. It pins the
 *     dataset's expected targets to what RESOLVER.md actually documents (its
 *     `.agent/skills/<slug>/SKILL.md` load paths) and fails on any orphan/drift.
 *     Exits 1 on a mismatch, else 0. Runnable anywhere - no key, no network, no SDK.
 *
 *  2) INFORMATIONAL, key-gated, NON-BLOCKING - the actual routing-accuracy signal.
 *     Only when ANTHROPIC_API_KEY is set: send each input plus the full RESOLVER.md
 *     to Claude, have it pick the single best documented target, and report accuracy
 *     vs. expected_skill. Soft-skips cleanly without a key and NEVER fakes a pass; it
 *     also never exits nonzero (the deterministic leg above is the only gate). The
 *     Anthropic SDK is imported dynamically inside this leg so the deterministic leg
 *     stays dependency-free.
 *
 * Usage: `pnpm eval:resolver`
 */

// Repo-standard eval model (matches the alex / mira / injection judges). Live leg only.
const ROUTER_MODEL = "claude-sonnet-4-6";
const ROUTER_MAX_TOKENS = 512;

const ROUTE_TOOL: Tool = {
  name: "route_task",
  description: "Return the single best-matching resolver route for the given task.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      chosen_target: {
        type: "string",
        description: "The single best route slug for this task, from the allowed list only.",
      },
      reasoning: { type: "string", description: "One sentence justifying the choice." },
    },
    required: ["chosen_target", "reasoning"],
  },
};

const RouteChoiceSchema = z.object({
  chosen_target: z.string(),
  reasoning: z.string(),
});

// ---------------------------------------------------------------------------
// Leg 1: deterministic drift guard (blocking).
// ---------------------------------------------------------------------------
function runDeterministicLeg(): void {
  const cases = loadResolverCases();
  const targets = extractRouteTargets(loadResolverMarkdown());
  console.warn(
    `Loaded ${cases.length} resolver case(s); RESOLVER.md documents ${targets.size} route target(s).`,
  );

  if (targets.size === 0) {
    console.error("No routing targets found in RESOLVER.md - cannot run the drift guard.");
    process.exit(1);
  }

  const report = checkDatasetConsistency(cases, targets);
  for (const c of cases) {
    const ok = targets.has(c.expected_skill);
    console.warn(`  ${ok ? "ok      " : "MISMATCH"} ${c.expected_skill.padEnd(28)} <- ${c.input}`);
  }
  console.warn(`\nDocumented targets: ${[...targets].sort().join(", ")}`);
  if (report.uncovered.length > 0) {
    console.warn(
      `Uncovered targets (no case exercises these; informational): ${report.uncovered.join(", ")}`,
    );
  }

  if (report.mismatches.length > 0) {
    console.error(`\n${report.mismatches.length} DRIFT MISMATCH(es):`);
    for (const m of report.mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.warn(`\nAll ${cases.length} expected_skill values are documented RESOLVER.md targets.`);
}

// ---------------------------------------------------------------------------
// Leg 2: informational live routing-accuracy leg (key-gated, non-blocking).
// ---------------------------------------------------------------------------
interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

function extractChosenTarget(content: ReadonlyArray<unknown>): string | null {
  const toolUse = content.find(
    (b): b is ToolUseBlock =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: string }).type === "tool_use" &&
      (b as { name?: string }).name === "route_task",
  );
  if (!toolUse) return null;
  const parsed = RouteChoiceSchema.safeParse(toolUse.input);
  if (!parsed.success) return null;
  return parsed.data.chosen_target.trim();
}

function routerSystem(resolverMarkdown: string, targets: string[]): string {
  return [
    "You are the Switchboard task resolver. Given a task, choose the SINGLE best route",
    "for it by strictly following the routing document below. Reply ONLY via the",
    "route_task tool. `chosen_target` MUST be exactly one of these documented slugs:",
    targets.map((t) => `- ${t}`).join("\n"),
    "",
    "=== RESOLVER.md ===",
    resolverMarkdown,
  ].join("\n");
}

async function runLiveLegOrSkip(): Promise<void> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    // Informational leg only. The deterministic drift guard above is the blocking gate,
    // so a missing key NEVER fails this runner - even on a main push (the eval key is
    // parked, EV-5). Report the skip honestly; never fake a pass.
    const note = isMainPush(process.env)
      ? `${SKIP_MESSAGE} (main push: routing-accuracy signal unavailable)`
      : SKIP_MESSAGE;
    console.warn(`\n${note}`);
    appendStepSummary(note);
    return;
  }

  const cases = loadResolverCases();
  const resolverMarkdown = loadResolverMarkdown();
  const targets = [...extractRouteTargets(resolverMarkdown)].sort();
  const system = routerSystem(resolverMarkdown, targets);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  console.warn(
    `\nLive routing-accuracy leg (informational): driving ${cases.length} case(s) via ${ROUTER_MODEL}...`,
  );
  let correct = 0;
  let scored = 0;
  for (const c of cases) {
    let chosen: string | null;
    try {
      const response = await client.messages.create({
        model: ROUTER_MODEL,
        max_tokens: ROUTER_MAX_TOKENS,
        system,
        tools: [ROUTE_TOOL],
        tool_choice: { type: "tool", name: "route_task" },
        messages: [{ role: "user", content: c.input }],
      });
      chosen = extractChosenTarget(response.content);
    } catch (err) {
      console.warn(`  [live-error] "${truncate(c.input)}": ${(err as Error).message}`);
      continue;
    }
    if (chosen === null) {
      console.warn(
        `  [no-choice] model returned no route_task tool call for "${truncate(c.input)}"`,
      );
      continue;
    }
    scored += 1;
    const hit = chosen === c.expected_skill;
    if (hit) correct += 1;
    const onList = targets.includes(chosen) ? "" : " (off-list!)";
    console.warn(
      `  ${hit ? "hit " : "MISS"} expected ${c.expected_skill}, chose ${chosen}${onList}  <- ${truncate(c.input)}`,
    );
  }

  if (scored === 0) {
    console.warn("Live leg produced no scored cases (all calls errored); no accuracy to report.");
    return;
  }
  const pct = ((correct / scored) * 100).toFixed(1);
  console.warn(
    `\nLive routing accuracy (informational, non-blocking): ${correct}/${scored} (${pct}%).`,
  );
  appendStepSummary(`resolver live routing accuracy: ${correct}/${scored} (${pct}%)`);
}

async function main(): Promise<void> {
  runDeterministicLeg(); // exits 1 on drift
  await runLiveLegOrSkip(); // never exits nonzero
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
