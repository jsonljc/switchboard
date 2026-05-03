"use client";

import { useEffect, useRef, useState } from "react";
import { useEscalationReply } from "@/hooks/use-escalation-reply";

interface ReplyFormProps {
  escalationId: string;
  channelName: string;
  onSent: () => void;
}

export function ReplyForm({ escalationId, channelName, onSent }: ReplyFormProps) {
  const { send, isPending } = useEscalationReply(escalationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Spec: clicking "Reply inline ▾" or the primary [Reply] button is an
  // expand-and-focus affordance. ReplyForm only mounts when the panel is
  // expanded, so focusing on mount matches that contract.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!text.trim()) return;
    setError(null);
    try {
      const result = await send(text.trim());
      if (result.ok) {
        setText("");
        onSent();
      } else {
        const upstream = result.error ?? "channel delivery failed.";
        setError(`Couldn't deliver to ${channelName} right now — ${upstream}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply.");
    }
  };

  return (
    <div className="reply-form">
      <textarea
        ref={textareaRef}
        aria-label="Reply"
        className="reply-form-text"
        rows={3}
        value={text}
        disabled={isPending}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <p role="alert" className="reply-error">
          {error}
        </p>
      )}
      <div className="reply-form-actions">
        <button
          type="button"
          className="btn btn-primary-graphite reply-form-send"
          disabled={isPending}
          onClick={handleSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}
