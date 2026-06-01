import { ModelRouter } from "@switchboard/core";

/**
 * Flag-gated construction of the per-turn model router for Alex.
 *
 * Returns a `ModelRouter` only when `ALEX_MODEL_ROUTER_ENABLED === "true"`,
 * otherwise `undefined` — in which case `SkillExecutorImpl.resolveProfile()`
 * returns `undefined` and the adapter falls back to its default model
 * (production behavior is byte-identical to before the router was wired).
 *
 * The flag-value parameter defaults from the literal
 * `process.env.ALEX_MODEL_ROUTER_ENABLED` so `scripts/check-env-completeness.ts`
 * (which greps `process.env.FOO`) detects the variable, while unit tests stay
 * pure by injecting the string directly.
 */
export function resolveModelRouter(
  flagValue: string | undefined = process.env.ALEX_MODEL_ROUTER_ENABLED,
): ModelRouter | undefined {
  return flagValue === "true" ? new ModelRouter() : undefined;
}
