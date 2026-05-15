"use client";

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
  alex: "Alex",
  operator: "You",
};

export function ThreadPreview({ contactId, who, messages }: ThreadPreviewProps) {
  const router = useRouter();
  if (messages.length === 0) return null;
  return (
    <div
      style={{
        background: T.hairSoft,
        borderRadius: 6,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "8px 0 12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: m.from === "contact" ? T.ink3 : T.ink2,
                minWidth: 44,
              }}
            >
              {m.from === "contact" ? who : FROM_LABEL[m.from]}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: T.ink }}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => router.push(`/contacts/${encodeURIComponent(contactId)}?takeover=true`)}
          style={{
            background: T.paper,
            border: `1px solid ${T.hair}`,
            borderRadius: 4,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: T.ink2,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Send as me
        </button>
      </div>
    </div>
  );
}
