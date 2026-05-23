import { appendFileSync } from "node:fs";

// Canonical SKIPPED message. Exported so tests can pin its wording and so
// run-eval.ts imports it instead of inlining the string.
export const SKIP_MESSAGE = "claim-classifier eval skipped: ANTHROPIC_API_KEY is not available";

export function isMainPush(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env["GITHUB_EVENT_NAME"] === "push" && env["GITHUB_REF"] === "refs/heads/main";
}

export interface PromptHashCheck {
  ok: boolean;
  currentHash: string;
  baselineHash: string;
}

export function comparePromptHash(currentHash: string, baselineHash: string): PromptHashCheck {
  return {
    ok: currentHash === baselineHash,
    currentHash,
    baselineHash,
  };
}

export function appendStepSummary(
  message: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const path = env["GITHUB_STEP_SUMMARY"];
  if (!path) return;
  appendFileSync(path, message + "\n");
}
