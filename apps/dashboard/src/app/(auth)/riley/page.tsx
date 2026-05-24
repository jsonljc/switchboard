import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { RileyCockpitPage } from "@/components/cockpit/riley-cockpit-page";

// The editorial shell (header + providers) is mounted once by the (auth) layout's
// AppShell, so this page renders its cockpit content directly.
export default async function RileyPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("riley")) notFound();

  return <RileyCockpitPage />;
}
