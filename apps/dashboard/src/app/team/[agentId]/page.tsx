import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  redirect(`/settings/team/${agentId}`);
}
