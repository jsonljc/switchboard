"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmTabs, type CrmTab } from "@/components/crm/crm-tabs.js";
import { ContactList, type ContactListItem } from "@/components/crm/contact-list.js";
import { ContactDetail } from "@/components/crm/contact-detail.js";
import { useLeads } from "@/hooks/use-leads.js";
import { useConversations } from "@/hooks/use-conversations.js";
import { useViewPreference } from "@/hooks/use-view-preference.js";

export default function CrmPage() {
  const { status } = useSession();
  const { isOwner } = useViewPreference();
  const [activeTab, setActiveTab] = useState<CrmTab>("leads");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");

  const { data: leads = [], isLoading: leadsLoading } = useLeads();
  const { data: convsData, isLoading: convsLoading } = useConversations({});

  if (status === "unauthenticated") redirect("/login");

  const conversations = convsData?.conversations ?? [];

  const leadContacts: ContactListItem[] = leads.map((l) => ({
    id: l.contact.id,
    displayName: l.displayName,
    channel: l.contact.channel ?? undefined,
    stage: l.stage,
    lastMessage: undefined,
    lastActivityAt: l.contact.createdAt,
  }));

  const chatContacts: ContactListItem[] = conversations.map((c) => ({
    id: c.id,
    displayName: c.principalId,
    channel: c.channel,
    stage: undefined,
    lastMessage: c.currentIntent ?? undefined,
    lastActivityAt: c.lastActivityAt,
    isEscalated: c.status === "human_override",
  }));

  const escalatedContacts = chatContacts.filter((c) => c.isEscalated);

  const counts = {
    leads: leadContacts.length,
    chats: chatContacts.length,
    escalations: escalatedContacts.length,
    inbox: 0,
  };

  const tabContacts: Record<CrmTab, ContactListItem[]> = {
    leads: leadContacts,
    chats: chatContacts,
    escalations: escalatedContacts,
    inbox: [],
  };

  const activeContacts = tabContacts[activeTab];
  const isLoading = leadsLoading || convsLoading;

  if (isOwner) {
    const filteredLeads =
      filter === "ALL" ? leadContacts : leadContacts.filter((l) => l.stage === filter);

    return (
      <div className="space-y-6">
        <section>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">CRM</h1>
        </section>

        <div className="flex gap-2 flex-wrap">
          {["ALL", "NEW", "QUALIFIED", "BOOKED"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors duration-fast ${
                filter === f
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (
          <ContactList contacts={filteredLeads} compact />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">CRM</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Your contacts, conversations, and escalations in one place.
        </p>
      </section>

      <CrmTabs activeTab={activeTab} onTabChange={setActiveTab} counts={counts} />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
          <ContactList
            contacts={activeContacts}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          />

          <div className="lg:sticky lg:top-20 lg:self-start">
            {selectedId ? (
              <div className="rounded-xl border border-border/60 bg-surface p-5">
                <ContactDetail contactId={selectedId} conversationId={selectedId} />
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
                <p className="text-[13.5px] text-muted-foreground">
                  Select a contact to view details.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
