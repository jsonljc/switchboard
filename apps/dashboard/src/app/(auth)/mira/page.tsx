import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraDeskPage } from "@/components/cockpit/mira/mira-desk-page";

// Phase 2: `/mira` is the Director's Desk (calm control surface). The vertical
// review feed moved to `/mira/review`; the per-draft deep link stays
// `/mira/creatives/[id]`. Mira is opt-in per org — 404 unless enabled.
export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return <MiraDeskPage />;
}
