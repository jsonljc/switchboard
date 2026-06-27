/**
 * Strict default-OFF gate for the Riley self-execution env kill switches (Spec-1B reallocate /
 * Phase-C pause). Wiring a self-execution submitter into the ad-optimizer cron deps is a real-money
 * boundary, so the env half is fail-closed: ONLY the exact string "true" enables it. Anything else -
 * unset, "false", "1", "TRUE", "yes", a stray-whitespace "true " - leaves the submitter unwired.
 *
 * This is the env half of the MONEY-8 double gate; the per-org governanceSettings flag is the
 * second, independent gate, and both must be on for a submitter to reach a deployment's AuditRunner
 * (the composition is pinned in packages/ad-optimizer inngest-functions-handoff.test.ts). Kept pure
 * and env-injectable so the default-OFF semantics are unit-pinned without standing up the whole
 * Inngest bootstrap. An off flag is not a safety boundary on its own (Knight Capital), but a
 * fail-OPEN env gate (e.g. `!== "false"`) would be a latent self-execution hazard - hence the strict
 * equality, pinned by an eval.
 */
export function selfExecutionEnvEnabled(
  env: Record<string, string | undefined>,
  key: string,
): boolean {
  return env[key] === "true";
}
