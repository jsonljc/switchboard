"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useConversationDetail } from "@/hooks/use-conversations";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

interface ContactInfo {
  displayName: string;
  email?: string;
  phone?: string;
  channel?: string;
  stage?: string;
  createdAt: string;
}

interface ContactDetailProps {
  contactId: string;
  contactInfo?: ContactInfo;
  conversationId?: string;
}

export function ContactDetail({
  contactId: _contactId,
  contactInfo,
  conversationId,
}: ContactDetailProps) {
  const { data: convData, isLoading: convLoading } = useConversationDetail(conversationId ?? null);

  return (
    <div className="space-y-6">
      {contactInfo && (
        <section>
          <h3 className="section-label mb-3">Contact</h3>
          <div className="rounded-xl border border-border/60 bg-surface p-4 space-y-2">
            <p className="text-[15px] font-medium text-foreground">{contactInfo.displayName}</p>
            {contactInfo.email && (
              <p className="text-[13px] text-muted-foreground">{contactInfo.email}</p>
            )}
            {contactInfo.phone && (
              <div className="flex items-center gap-2">
                <p className="text-[13px] text-muted-foreground">{contactInfo.phone}</p>
                <a
                  href={`tel:${contactInfo.phone}`}
                  className="text-[12px] text-foreground underline underline-offset-2"
                >
                  Call
                </a>
              </div>
            )}
            {contactInfo.channel && (
              <p className="text-[12px] text-muted-foreground capitalize">
                Channel: {contactInfo.channel}
              </p>
            )}
            <p className="text-[12px] text-muted-foreground">
              Created: {formatRelative(contactInfo.createdAt)}
            </p>
          </div>
        </section>
      )}

      <section>
        <h3 className="section-label mb-3">Conversation</h3>
        {convLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !convData?.messages || convData.messages.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-surface p-5">
            <p className="text-[13px] text-muted-foreground">No messages yet.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {convData.messages.map((msg, idx) => {
              const isUser = msg.role === "user" || msg.role === "lead";
              return (
                <div key={idx} className={cn("flex", isUser ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2.5 max-w-[80%]",
                      isUser ? "bg-muted text-foreground" : "bg-foreground/10 text-foreground",
                    )}
                  >
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {msg.role} &middot; {formatRelative(msg.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
