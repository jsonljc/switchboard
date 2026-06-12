// apps/dashboard/src/lib/route-availability.ts
//
// Single source of truth for "is route X live" in the dashboard.
//
// Two policies live here, intentionally distinct:
//
// 1. isMercuryToolLive(id) — env-var-driven. Each Mercury Tools surface
//    (list + detail) ships as a unit and turns on when its NEXT_PUBLIC_*_LIVE
//    flag is "true". MUST be a static switch — one literal NEXT_PUBLIC_*_LIVE
//    read per id (see below). Next.js only inlines NEXT_PUBLIC_* into the
//    client bundle via static literal member access, so a computed/bracket env
//    read is permanently undefined in the browser (F9 / the F-20 bug). Do NOT
//    refactor back to a keyed-map + bracket lookup — the no-restricted-syntax
//    eslint rule and scripts/check-no-dynamic-public-env.ts guard against it.
//    Read per-call so vitest can mutate process.env between tests; in
//    production the reads are build-time constants.
//
// 2. isAgentHomeLinkLive(kind) — compile-time map keyed by AgentHomeLink
//    discriminator. Adding a new kind to the AgentHomeLink union forces a
//    type-error here, preventing silently-undefined lookups at the
//    resolveAgentHomeLink call site. `contact` defers to isMercuryToolLive
//    so list and detail availability stay coupled (with
//    NEXT_PUBLIC_CONTACTS_LIVE=false, agent-home tiles must NOT produce
//    clickable /contacts/[id] links).
//
// The two policies are not unified because they have different lifetimes
// and consumers: env-var gates flip independently per environment, while
// agent-home link kinds gate on whether a target route exists in the build.
import type { AgentHomeLink } from "./agent-home/types";

export type ToolsNavId = "contacts" | "automations" | "activity" | "reports" | "approvals";

export function isMercuryToolLive(id: ToolsNavId): boolean {
  // One static literal read per id so Next.js inlines each into the client
  // bundle. Exhaustive over ToolsNavId: adding a member without a branch lets
  // `id` reach the function end as a non-never type, raising TS2366.
  switch (id) {
    case "contacts":
      return process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true";
    case "automations":
      return process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE === "true";
    case "activity":
      return process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true";
    case "reports":
      return process.env.NEXT_PUBLIC_REPORTS_LIVE === "true";
    case "approvals":
      return process.env.NEXT_PUBLIC_APPROVALS_LIVE === "true";
  }
}

export function isAgentHomeLinkLive(kind: AgentHomeLink["kind"]): boolean {
  switch (kind) {
    case "contact":
      return isMercuryToolLive("contacts");
    case "creative-job":
      // Live as of Mira M1 PR5 — the /mira/creatives/[id] draft-review route
      // exists, so agent-home tiles may produce clickable creative-job links.
      return true;
    case "ad-set":
    case "agent-setup":
    case "all-wins":
      return false;
  }
}
