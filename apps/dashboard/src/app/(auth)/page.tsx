import { HomePage } from "@/components/home/home-page";
import { parsePanelAgentKey } from "@/components/agent-panel/lib/agent-display";

// Read the `?agent=` deep-link on the server and pass a validated agent down, so
// the retired /alex and /riley routes can redirect here to auto-open the panel.
// Reading searchParams on the server avoids a client useSearchParams + Suspense.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const { agent } = await searchParams;
  const initialAgent = parsePanelAgentKey(Array.isArray(agent) ? agent[0] : agent);
  return <HomePage initialAgent={initialAgent} />;
}
