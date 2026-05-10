// apps/dashboard/src/lib/agent-home/resolve-link.ts
import { isAgentHomeLinkLive } from "../route-availability.js";
import type { AgentHomeLink } from "./types.js";

export type ResolvedAgentHomeLink =
  | { href: string; disabled: false }
  | { href: null; disabled: true; reason: "route-not-available" };

export function resolveAgentHomeLink(link: AgentHomeLink): ResolvedAgentHomeLink {
  if (!isAgentHomeLinkLive(link.kind)) {
    return { href: null, disabled: true, reason: "route-not-available" };
  }
  switch (link.kind) {
    case "contact":
      return { href: `/contacts/${link.id}`, disabled: false };
    case "ad-set":
      return { href: `/riley/ad-sets/${link.id}`, disabled: false };
    case "creative-job":
      return { href: `/mira/creatives/${link.id}`, disabled: false };
    case "agent-setup":
      return { href: `/${link.agentKey}/setup`, disabled: false };
    case "all-wins":
      return { href: `/${link.agentKey}/wins`, disabled: false };
  }
}
