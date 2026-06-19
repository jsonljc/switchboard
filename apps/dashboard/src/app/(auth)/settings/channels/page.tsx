"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ConnectionsList } from "@/components/settings/connections-list";
import { ChannelManagement } from "@/components/settings/channel-management";
import { PageTitle } from "@/components/layout/page-title";

export default function SettingsChannelsPage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-10">
      <PageTitle eyebrow="Settings" sub="Connect the services your operator needs to act safely.">
        Channels
      </PageTitle>

      <ConnectionsList />
      <ChannelManagement />
    </div>
  );
}
