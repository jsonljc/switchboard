import { redirect } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraDeskPage } from "@/components/cockpit/mira/mira-desk-page";

// Phase 2: `/mira` is the Director's Desk (calm control surface). The vertical
// review feed moved to `/mira/review`; the per-draft deep link stays
// `/mira/creatives/[id]`. Mira is opt-in per org. When it is NOT enabled, fall
// back to Home's `?agent=mira` deep-link (the read-only agent panel) instead of
// a bare 404, mirroring the retired /alex and /riley routes so no nav or
// agent-card target ever resolves to a generic "Page not found".
export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) redirect("/?agent=mira");

  return <MiraDeskPage />;
}
