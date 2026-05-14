"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { WhatsAppManagement } from "@/components/settings/whatsapp-management";
import { ChevronRight } from "lucide-react";

export default function WhatsAppChannelPage() {
  const { status } = useSession();
  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <section>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
          <Link href="/settings" className="hover:text-foreground">
            Settings
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/settings/channels" className="hover:text-foreground">
            Channels
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground">WhatsApp</span>
        </nav>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">WhatsApp</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Manage your WhatsApp Business connection, phone numbers, and message templates.
        </p>
      </section>
      <WhatsAppManagement />
    </div>
  );
}
