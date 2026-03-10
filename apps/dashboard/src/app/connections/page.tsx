"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ConnectionsList } from "@/components/settings/connections-list";
import { ChannelManagement } from "@/components/settings/channel-management";

export default function ConnectionsPage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connections</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Connect the services your operator needs to act safely.
        </p>
      </section>

      <ConnectionsList />
      <ChannelManagement />
    </div>
  );
}
