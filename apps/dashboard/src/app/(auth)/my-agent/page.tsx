import { getApiClient } from "@/lib/get-api-client";
import { redirect } from "next/navigation";

export default async function MyAgentIndexPage() {
  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();

    if (deployments.length === 0) {
      redirect("/marketplace");
    }

    // Sort by most recently updated and redirect to the latest
    const sorted = [...deployments].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    redirect(`/my-agent/${sorted[0].id}`);
  } catch {
    redirect("/marketplace");
  }
}
