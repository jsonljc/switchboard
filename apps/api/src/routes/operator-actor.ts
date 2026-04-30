import type { FastifyRequest } from "fastify";
import type { Actor } from "@switchboard/core/platform";

// Per spec §4.4 + §10.1: API-key auth has no per-user identifier today, so we
// attribute operator mutations to the API key's principal id (an org-scoped
// dashboard service account, not the specific human who clicked). A follow-up
// risk introduces per-user attribution via per-user keys or a dashboard-signed
// user-id header.
export function resolveOperatorActor(request: FastifyRequest): Actor {
  const id = request.principalIdFromAuth ?? "operator";
  return { type: "user", id };
}
