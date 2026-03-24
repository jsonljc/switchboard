"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ConnectionsList } from "@/components/settings/connections-list";
import { ChannelManagement } from "@/components/settings/channel-management";

export default function SettingsChannelsPage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Channels</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Connect the services your operator needs to act safely.
        </p>
      </section>

      <ConnectionsList />
      <ChannelManagement />
    </div>
  );
}
