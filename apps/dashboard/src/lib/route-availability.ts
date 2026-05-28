// apps/dashboard/src/lib/route-availability.ts
//
// Single source of truth for "is route X live" in the dashboard.
//
// Two policies live here, intentionally distinct:
//
// 1. isMercuryToolLive(id) — env-var-driven, runtime. Each Mercury Tools
//    surface (list + detail) ships as a unit and turns on when its
//    NEXT_PUBLIC_*_LIVE flag is "true". Read per-call so vitest can mutate
//    process.env between tests; in production Next.js inlines NEXT_PUBLIC_*
//    at build time so this is effectively a constant.
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

const TOOLS_LIVE_ENV = {
  contacts: "NEXT_PUBLIC_CONTACTS_LIVE",
  automations: "NEXT_PUBLIC_AUTOMATIONS_LIVE",
  activity: "NEXT_PUBLIC_ACTIVITY_LIVE",
  reports: "NEXT_PUBLIC_REPORTS_LIVE",
  approvals: "NEXT_PUBLIC_APPROVALS_LIVE",
} as const satisfies Record<ToolsNavId, string>;

export function isMercuryToolLive(id: ToolsNavId): boolean {
  return process.env[TOOLS_LIVE_ENV[id]] === "true";
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
