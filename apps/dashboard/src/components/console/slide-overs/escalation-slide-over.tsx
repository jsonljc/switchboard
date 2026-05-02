"use client";

import Link from "next/link";
import { useState } from "react";
import { ConsoleSlideOver } from "./console-slide-over";
import { useEscalationReply } from "@/hooks/use-escalation-reply";

interface EscalationSlideOverProps {
  escalationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slide-over for replying to an escalation from /console.
 *
 * Consumes the shared `useEscalationReply(escalationId)` hook so this
 * surface cannot diverge from `/escalations` on payload shape, cache
 * invalidation, or 200/502 branching.
 *
 * On 200 success: clear the textarea and close the slide-over.
 * On 502 delivery failure (PR-2 once the proxy stops collapsing 502 → 500):
 * preserve the textarea contents and surface the error inline so the
 * operator can retry or contact the customer through another channel.
 *
 * "Open full conversation →" deep-links to `/conversations/[escalationId]`
 * for the threaded transcript and full lead context.
 */
export function EscalationSlideOver({
  escalationId,
  open,
  onOpenChange,
}: EscalationSlideOverProps) {
  const { send, isPending } = useEscalationReply(escalationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setError(null);
    try {
      const result = await send(text);
      if (result.ok) {
        setText("");
        onOpenChange(false);
      } else {
        setError(result.error ?? "Channel delivery failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed");
    }
  };

  return (
    <ConsoleSlideOver open={open} onOpenChange={onOpenChange} title="Reply to escalation">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Escalation {escalationId}. Reply directly here, or open the full conversation for the
          threaded transcript and lead context.
        </p>
        <textarea
          aria-label="Reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isPending}
          rows={6}
          className="w-full rounded border border-input bg-background p-2 text-sm"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Send reply"
            onClick={handleSend}
            disabled={isPending}
            className="btn btn-primary-graphite"
          >
            Send
          </button>
        </div>
        <Link
          href={`/conversations/${escalationId}`}
          className="block text-sm text-muted-foreground underline"
        >
          Open full conversation →
        </Link>
      </div>
    </ConsoleSlideOver>
  );
}
