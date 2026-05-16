"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import type { ThreadMessage } from "./types";

export interface ThreadPreviewProps {
  contactId: string;
  who: string;
  messages: ThreadMessage[];
}

const FROM_LABEL: Record<ThreadMessage["from"], string> = {
  contact: "",
  alex: "ALEX",
  operator: "YOU",
};

export function ThreadPreview({ contactId, who, messages }: ThreadPreviewProps) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  if (messages.length === 0) return null;

  // The design's intent is a true inline reply, but the operator-send-message
  // dashboard mutation hook does not exist yet (api side has POST
  // /api/conversations/:threadId/send; no client wrapper). Until that lands,
  // both buttons navigate to the contact thread where the takeover composer
  // owns the actual reply UI. We deliberately do NOT forward the typed text
  // as a query param — the contacts/[id] page does not read prefill, so
  // doing so would produce silent data loss (operator types, hits Send,
  // typed text vanishes on navigation). The placeholder copy below is
  // honest about this indirection.
  const trimmed = reply.trim();
  const openThread = () => {
    router.push(`/contacts/${encodeURIComponent(contactId)}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && trimmed) {
      e.preventDefault();
      openThread();
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 14px",
        background: T.paper,
        border: `1px solid ${T.hair}`,
        borderRadius: 6,
        maxWidth: 640,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((m, i) => {
          const label = m.from === "contact" ? who.toUpperCase() : FROM_LABEL[m.from];
          const isAgent = m.from === "alex";
          return (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10.5,
                  color: isAgent ? T.amber : T.ink3,
                  letterSpacing: "0.04em",
                  flexShrink: 0,
                  width: 64,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: T.ink2,
                }}
              >
                {m.text}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px dashed ${T.hair}`,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 10,
            color: T.ink4,
            letterSpacing: "0.08em",
            width: 64,
          }}
        >
          YOU
        </span>
        <input
          aria-label={`Reply to ${who}`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Open the thread to reply…"
          style={{
            flex: 1,
            border: `1px solid ${T.hair}`,
            background: T.bg,
            borderRadius: 4,
            padding: "6px 10px",
            fontFamily: "inherit",
            fontSize: 13,
            color: T.ink,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={openThread}
          disabled={!trimmed}
          style={{
            background: trimmed ? T.ink : T.ink5,
            color: "#fff",
            border: "none",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: trimmed ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          Send as me
        </button>
        <button
          type="button"
          onClick={openThread}
          style={{
            background: "transparent",
            color: T.ink3,
            border: `1px solid ${T.hair}`,
            padding: "6px 10px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Ask Alex to draft
        </button>
      </div>
    </div>
  );
}
