/**
 * Production safety guard for the ALLOW_SELF_APPROVAL flag.
 *
 * ALLOW_SELF_APPROVAL lets an action's originator approve their own pending
 * action, disabling the "four-eyes" rule. It is a legitimate solo-operator
 * knob, off by default, and is NOT a tenant or auth bypass (org isolation and
 * server-derived responder identity still apply). But unlike DEV_BYPASS_AUTH,
 * nothing previously stopped it from being enabled in production by accident.
 *
 * This mirrors the dashboard's assertSafeDashboardAuthEnv()
 * (apps/dashboard/src/lib/dev-auth.ts): a misconfigured production boot fails
 * fast. Because self-approval is a real solo-operator need (not a dev-only
 * crutch), it stays possible in production, but only behind a deliberate
 * acknowledgement flag rather than being silently allowed.
 *
 * Truth table (production only; every non-production env is a no-op):
 *   ALLOW_SELF_APPROVAL falsy                    -> no-op
 *   ALLOW_SELF_APPROVAL truthy, ack !== "true"   -> THROW (fail fast at boot)
 *   ALLOW_SELF_APPROVAL truthy, ack === "true"   -> allowed, console.warn
 *
 * Detection of ALLOW_SELF_APPROVAL uses the same truthiness as the route reads
 * (!!process.env.ALLOW_SELF_APPROVAL in approvals.ts / internal-chat-approvals.ts
 * and app.ts): any non-empty string counts as "on", so the guard is never
 * weaker than the flag it protects. The acknowledgement is accepted only on an
 * exact "true" (mirrors DEV_BYPASS_AUTH === "true"), which fails closed for
 * ambiguous values.
 */
export function assertSafeSelfApprovalEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const selfApprovalEnabled = !!process.env.ALLOW_SELF_APPROVAL;
  if (!selfApprovalEnabled) {
    return;
  }

  const acknowledged = process.env.ALLOW_SELF_APPROVAL_IN_PRODUCTION === "true";
  if (!acknowledged) {
    throw new Error(
      "ALLOW_SELF_APPROVAL is enabled in production, which disables four-eyes " +
        "approval (an action's originator could approve their own action). " +
        "Refusing to start. If this is a deliberate solo-operator deployment, " +
        "set ALLOW_SELF_APPROVAL_IN_PRODUCTION=true to acknowledge it; " +
        "otherwise unset ALLOW_SELF_APPROVAL.",
    );
  }

  console.warn(
    "[api] ALLOW_SELF_APPROVAL is enabled in production: four-eyes self-approval " +
      "prevention is OFF (acknowledged via ALLOW_SELF_APPROVAL_IN_PRODUCTION). " +
      "An action's originator can approve their own action.",
  );
}
