import { resolve } from "node:path";
import { loadSkill, buildSystemPrompt } from "@switchboard/core/skill-runtime";
import { resolveParameters } from "../alex-conversation/run-conversation.js";
import type { ConversationFixture } from "../alex-conversation/schema.js";

const SKILLS_DIR = resolve(import.meta.dirname, "../../skills");

/**
 * Pinned so the golden never drifts on wall-clock: alexBuilder sets
 * CURRENT_DATETIME from `config.now?.() ?? new Date()` (packages/core
 * builders/alex.ts), which is non-deterministic. We override it AFTER resolution
 * so the snapshot is stable while every other injected slot renders through the
 * real production path.
 */
export const PINNED_DATETIME = "2026-07-01 (Wednesday) 10:00 Asia/Singapore";

/**
 * Assemble the exact medspa system prompt for a fixture the same way production
 * does: loadSkill -> resolveParameters (persona + alexBuilder + ContextResolver
 * over file-stub context) -> buildSystemPrompt. Mirrors
 * evals/alex-conversation/run-conversation.ts + packages/core skill-mode.ts;
 * keep them in sync. Model-free and DB-free (stubbed stores, file-stub context).
 */
export async function renderMedspaPrompt(fixture: ConversationFixture): Promise<string> {
  const skill = loadSkill("alex", SKILLS_DIR);
  const parameters = await resolveParameters(skill, fixture);
  return buildSystemPrompt(skill, { ...parameters, CURRENT_DATETIME: PINNED_DATETIME });
}
