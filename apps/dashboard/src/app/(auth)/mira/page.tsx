import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraCockpitPage } from "@/components/cockpit/mira-cockpit-page";

// The editorial shell (header + providers) is mounted once by the (auth) layout's
// AppShell, so this page renders its cockpit content directly. Mira is opt-in per
// org (no global day-one), so the route 404s unless this org has Mira enabled.
export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return <MiraCockpitPage />;
}
