import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";

/**
 * Returns a dev-mode preHandler that populates `request.organizationIdFromAuth`
 * and `request.principalIdFromAuth` from `x-org-id` / `x-principal-id`
 * headers, falling back to "default" when the headers are absent. The returned
 * handler is a no-op when `app.authDisabled === false` (production /
 * staging auth-enabled mode).
 *
 * Replaces the per-route `app.addHook("preHandler", async (request) => { if
 * (app.authDisabled) ... })` block currently duplicated across the 4
 * ingress-migrated routes (`dashboard-opportunities`, `recommendations`,
 * `lifecycle-disqualifications`, `admin-consent`).
 *
 * Factory shape (vs. a free function relying on `this`): captures the app
 * reference in a closure so plugin-scoped registrations work correctly
 * regardless of Fastify's hook binding semantics.
 *
 * Designed to run BEFORE `requireOrg` / `requireOrgForMutation` in the
 * preHandler chain so the org-id is populated by the time those decorators
 * check for it.
 *
 * Idempotent: does not overwrite a field already populated by an earlier
 * preHandler (e.g., the production auth middleware).
 */
export function buildDevAuthFallback(app: FastifyInstance): preHandlerAsyncHookHandler {
  return async function devAuthFallback(request) {
    if (app.authDisabled !== true) return;

    const orgHeader = request.headers["x-org-id"];
    if (typeof orgHeader === "string" && orgHeader.trim()) {
      request.organizationIdFromAuth = orgHeader.trim();
    } else if (!request.organizationIdFromAuth) {
      request.organizationIdFromAuth = "default";
    }

    const principalHeader = request.headers["x-principal-id"];
    if (typeof principalHeader === "string" && principalHeader.trim()) {
      request.principalIdFromAuth = principalHeader.trim();
    } else if (!request.principalIdFromAuth) {
      request.principalIdFromAuth = "default";
    }
  };
}
