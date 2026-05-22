import type { preHandlerAsyncHookHandler } from "fastify";

/**
 * Augment FastifyRequest with the narrowed `orgId` and `actorId` properties
 * that operator-direct preHandlers set. Once `requireOrg` (or
 * `requireOrgForMutation`) has run, the handler can read these as
 * non-nullable `string` — no `?? "unknown"` boilerplate, no `if (!orgId)
 * return;` checks.
 *
 * The narrowing is a runtime contract, not a TS-enforced invariant: if a
 * route handler accesses `request.orgId` without first registering one of
 * these preHandlers, it will read `undefined` at runtime even though TS
 * thinks the value is `string`. Treat this as a Fastify-decorator-typical
 * convention (the same trade-off as `app.prisma` etc.).
 */
declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by `requireOrg` or `requireOrgForMutation` preHandler. Non-null
     * when the handler executes. See header comment for the runtime-contract
     * caveat.
     */
    orgId: string;
    /**
     * Set by `requireOrg` or `requireOrgForMutation` preHandler. Defaults to
     * `"unknown"` when production auth middleware did not bind a principal
     * (rare in prod with auth middleware; common in dev mode where
     * `devAuthFallback` populated the principal to "default").
     */
    actorId: string;
  }
}

/**
 * Read-side org-scope preHandler. Use on GET routes that should fail closed
 * when no organization is bound. For mutations, prefer
 * {@link requireOrgForMutation}.
 *
 * Behavior (Route Governance Contract v1 §6.3, envelope §4.5):
 * - If `request.organizationIdFromAuth` is set → narrow `request.orgId`
 *   + `request.actorId` and continue.
 * - If not set → reply 403 `{ error: "forbidden", reason: "no_org_binding",
 *   statusCode: 403 }`.
 */
export const requireOrg: preHandlerAsyncHookHandler = async (request, reply) => {
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
  }
  request.orgId = orgId;
  request.actorId = request.principalIdFromAuth ?? "unknown";
};

/**
 * Write-side org-scope preHandler. Identical to {@link requireOrg} for the
 * 4 ingress-migrated routes (which do not accept body-supplied orgId). The
 * separate name + identical behavior is intentional: future tightening
 * (e.g., requiring an HMAC binding on mutating requests) lives here without
 * affecting read-side routes.
 *
 * Routes that DO accept body-supplied orgId in dev mode (e.g.,
 * `actions.ts:62`) keep using the legacy `resolveOrganizationForMutation`
 * helper — that's a separate PR-4 audit.
 */
export const requireOrgForMutation: preHandlerAsyncHookHandler = async (request, reply) => {
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
  }
  request.orgId = orgId;
  request.actorId = request.principalIdFromAuth ?? "unknown";
};

/**
 * PDPA-grade write-side preHandler. Use on routes whose audit trail must
 * never attribute a decision to a placeholder principal — currently the
 * admin-consent grant/revoke/clear endpoints. Adds a production-only
 * `principalIdFromAuth` requirement on top of {@link requireOrgForMutation}.
 *
 * Restores the pre-Route-Governance-Contract `resolveActor` guard that lived
 * in `bootstrap/routes.ts`: "Reject in production rather than fall back to a
 * placeholder. The audit trail must always have a real actor." The guard
 * was inadvertently lost when admin-consent's bespoke `resolveActor` was
 * removed in favor of the generic decorator — see bug_003 in PR #614
 * ultrareview.
 *
 * Behavior:
 * - Org absent → §4.5 envelope, `reason: "no_org_binding"` (any NODE_ENV).
 * - Org present, principal absent, `NODE_ENV === "production"` → §4.5
 *   envelope, `reason: "no_principal_binding"`. Forces the misconfigured
 *   API key (organizationId but no principalId) into a 403 the operator
 *   will notice, instead of a silent WorkTrace under `actor.id = "unknown"`.
 * - Org present, principal absent, non-production → `actorId = "unknown"`
 *   fallback (preserves the dev workflow where buildDevAuthFallback may
 *   not have populated the principal).
 */
export const requireOrgForAuditedMutation: preHandlerAsyncHookHandler = async (request, reply) => {
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
  }
  const principalId = request.principalIdFromAuth;
  if (!principalId && process.env["NODE_ENV"] === "production") {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_principal_binding",
      statusCode: 403,
    });
  }
  request.orgId = orgId;
  request.actorId = principalId ?? "unknown";
};
