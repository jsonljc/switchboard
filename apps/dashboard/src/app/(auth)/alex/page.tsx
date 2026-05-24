import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { CockpitPage } from "@/components/cockpit/cockpit-page";

// The editorial shell (header + providers) is mounted once by the (auth) layout's
// AppShell, so this page renders its cockpit content directly.
export default async function AlexPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("alex")) notFound();

  return <CockpitPage />;
}
