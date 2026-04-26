"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { LeadWebhooksList } from "@/components/settings/lead-webhooks-list";

export default function WebsiteLeadsSettingsPage() {
  const { status } = useSession();
  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Website leads</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Connect website forms so Alex can follow up on every lead automatically.
        </p>
      </section>
      <LeadWebhooksList />
    </div>
  );
}
