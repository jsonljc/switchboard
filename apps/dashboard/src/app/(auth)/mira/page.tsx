import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraFeedPage } from "@/components/cockpit/mira/mira-feed-page";

// The editorial shell (header + providers) is mounted once by the (auth) layout's
// AppShell, so this page renders its cockpit content directly. Mira is opt-in per
// org (no global day-one), so the route 404s unless this org has Mira enabled.
// This renders the review feed for enabled orgs.
export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return <MiraFeedPage />;
}
