import { appendFileSync } from "node:fs";

/** Canonical SKIPPED message. Exported so tests pin its wording. */
export const SKIP_MESSAGE =
  "adversarial-injection eval skipped: ANTHROPIC_API_KEY is not available";

/** True only on a push to `refs/heads/main` (where the live leg hard-fails on a missing key). */
export function isMainPush(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env["GITHUB_EVENT_NAME"] === "push" && env["GITHUB_REF"] === "refs/heads/main";
}

/** Append a line to the GitHub Actions step summary, if running in CI. */
export function appendStepSummary(
  message: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const path = env["GITHUB_STEP_SUMMARY"];
  if (!path) return;
  appendFileSync(path, message + "\n");
}
