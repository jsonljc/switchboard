"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useEscalations, useEscalationDetail, useReplyToEscalation } from "@/hooks/use-escalations";

export default function EscalationsPage() {
  const { status } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const { toast } = useToast();

  const escalations = useEscalations("pending");
  const detail = useEscalationDetail(selectedId);
  const replyMutation = useReplyToEscalation();

  if (status === "loading") return null;
  if (status === "unauthenticated") redirect("/login");

  const handleReply = () => {
    if (!selectedId || !replyText.trim()) return;

    replyMutation.mutate(
      { id: selectedId, message: replyText },
      {
        onSuccess: () => {
          toast({ title: "Reply sent" });
          setReplyText("");
          setSelectedId(null);
        },
        onError: () => {
          toast({ title: "Failed to send reply", variant: "destructive" });
        },
      },
    );
  };

  const escalationList = (escalations.data?.escalations ?? []) as Array<Record<string, unknown>>;
  const conversationHistory = (detail.data?.conversationHistory ?? []) as Array<
    Record<string, unknown>
  >;
  const selectedEscalation = detail.data?.escalation as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Escalation Inbox
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Review and reply to conversations that need your attention
        </p>
      </section>

      <div className="grid grid-cols-3 gap-4 h-[600px]">
        {/* Escalation List */}
        <div className="col-span-1 border rounded-lg bg-background overflow-y-auto">
          <div className="p-4 border-b sticky top-0 bg-background">
            <h2 className="text-[16px] font-medium">Pending ({escalationList.length})</h2>
          </div>
          <div className="divide-y">
            {escalationList.length === 0 && (
              <div className="p-4 text-center text-muted-foreground text-[14px]">
                No pending escalations
              </div>
            )}
            {escalationList.map((esc) => (
              <button
                key={String(esc.id)}
                onClick={() => setSelectedId(String(esc.id))}
                className={cn(
                  "w-full p-4 text-left hover:bg-accent transition-colors",
                  selectedId === String(esc.id) && "bg-accent",
                )}
              >
                <p className="text-[14px] font-medium">{String(esc.reason || "Unknown")}</p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {String(esc.principalId || "Unknown user")}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {new Date(String(esc.createdAt || Date.now())).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail and Reply */}
        <div className="col-span-2 border rounded-lg bg-background flex flex-col">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-[14px]">
              Select an escalation to view details
            </div>
          ) : (
            <>
              {/* Escalation Info */}
              <div className="p-4 border-b">
                <h2 className="text-[16px] font-medium">
                  {String(selectedEscalation?.reason || "Escalation")}
                </h2>
                <p className="text-[13px] text-muted-foreground mt-1">
                  User: {String(selectedEscalation?.principalId || "Unknown")}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Channel: {String(selectedEscalation?.channel || "Unknown")}
                </p>
              </div>

              {/* Conversation History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {conversationHistory.length === 0 && (
                  <div className="text-center text-muted-foreground text-[14px]">
                    No conversation history
                  </div>
                )}
                {conversationHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex",
                      String(msg.role) === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-4 py-2",
                        String(msg.role) === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted",
                      )}
                    >
                      <p className="text-[14px]">{String(msg.text || "")}</p>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        {new Date(String(msg.timestamp || Date.now())).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply Input */}
              <div className="p-4 border-t flex gap-2">
                <Input
                  placeholder="Type your reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReply();
                    }
                  }}
                  disabled={replyMutation.isPending}
                />
                <Button
                  onClick={handleReply}
                  disabled={replyMutation.isPending || !replyText.trim()}
                >
                  {replyMutation.isPending ? "Sending..." : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
