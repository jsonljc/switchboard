import { appendFileSync } from "node:fs";
import { createStubContextStore, SKILL_PACK_SCOPES } from "./stub-context-store.js";

// Canonical SKIPPED message. Exported so tests can pin its wording and so
// run-eval.ts imports it instead of inlining the string.
export const SKIP_MESSAGE = "alex-conversation eval skipped: ANTHROPIC_API_KEY is not available";

export function isMainPush(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env["GITHUB_EVENT_NAME"] === "push" && env["GITHUB_REF"] === "refs/heads/main";
}

export function appendStepSummary(
  message: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const path = env["GITHUB_STEP_SUMMARY"];
  if (!path) return;
  appendFileSync(path, message + "\n");
}

/**
 * Loud preflight: refuse to grade Alex unless the medspa skill pack actually has
 * content for every skill-pack scope. Mirrors the INTENT of the prisma
 * assertAlexSkillPackSeeded, but stub-aware (the eval is DB-free). The live
 * SkillMode path fails open + quiet on a context miss, so this is where a
 * provisioning/content regression must be impossible to miss.
 *
 * @param refsDir Override the medspa references dir (tests pass a fixture dir).
 */
export async function assertSkillPackContentPresent(refsDir?: string): Promise<void> {
  let store;
  try {
    store = createStubContextStore(refsDir);
  } catch (err) {
    throw new Error(
      `alex-conversation eval preflight: failed to load the medspa skill pack ` +
        `(skills/alex/references/medspa/*.md). Alex would run WITHOUT the medspa playbook. ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const filters = SKILL_PACK_SCOPES.map((s) => ({ kind: s.kind, scope: s.scope }));
  const rows = await store.findActive("eval-org", filters);
  const byKey = new Map(rows.map((r) => [`${r.kind}::${r.scope}`, r]));
  for (const s of SKILL_PACK_SCOPES) {
    const row = byKey.get(`${s.kind}::${s.scope}`);
    if (!row || row.content.trim().length === 0) {
      throw new Error(
        `alex-conversation eval preflight: skill-pack content missing/empty for ` +
          `${s.kind}/${s.scope} (expected skills/alex/references/medspa/${s.file}). ` +
          `Alex would run WITHOUT the medspa playbook — refusing to grade.`,
      );
    }
  }
}
