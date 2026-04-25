"use client";

import { useState } from "react";
import { formatRelative } from "@/lib/format";

interface ActivityEventProps {
  description: string;
  dotColor: "green" | "amber" | "blue" | "gray";
  createdAt: string;
  reasoning?: string | null;
}

const DOT_CSS: Record<string, string> = {
  green: "hsl(145, 45%, 42%)",
  amber: "var(--sw-accent)",
  blue: "hsl(210, 50%, 50%)",
  gray: "var(--sw-text-muted)",
};

export function ActivityEvent({ description, dotColor, createdAt, reasoning }: ActivityEventProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "start", gap: "12px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: DOT_CSS[dotColor] ?? DOT_CSS.gray,
            marginTop: "7px",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "16px", color: "var(--sw-text-primary)", margin: 0 }}>
            {description}
          </p>
          {reasoning && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                marginTop: "4px",
                fontSize: "13px",
                color: "var(--sw-accent)",
                cursor: "pointer",
              }}
            >
              {expanded ? "Hide reasoning" : "Why?"}
            </button>
          )}
          {expanded && reasoning && (
            <p
              style={{
                marginTop: "6px",
                fontSize: "13px",
                color: "var(--sw-text-secondary)",
                lineHeight: 1.5,
                padding: "8px 12px",
                background: "var(--sw-surface)",
                borderRadius: "8px",
              }}
            >
              {reasoning}
            </p>
          )}
        </div>
        <time style={{ fontSize: "13px", color: "var(--sw-text-muted)", flexShrink: 0 }}>
          {formatRelative(createdAt)}
        </time>
      </div>
    </div>
  );
}
