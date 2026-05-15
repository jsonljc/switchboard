"use client";

import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { lookupKindMeta } from "./kind-meta";
import { Dot } from "./dot";
import { ThreadPreview } from "./thread-preview";
import type { ActivityRow as ActivityRowType } from "./types";

export interface ActivityRowProps {
  item: ActivityRowType;
  open: boolean;
  toggle: () => void;
  compact?: boolean;
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function ActivityRow({ item, open, toggle, compact = false }: ActivityRowProps) {
  const router = useRouter();
  const meta = lookupKindMeta(item.kind);
  // Tight invariant: a row is expandable only when it both (a) declares
  // itself replyable AND (b) has at least one piece of expandable content
  // (a thread preview, a body line, or a contact deep-link). Riley rows
  // ship `replyable: false` and undefined preview/body/contactId, so they
  // remain collapsed forever — even if a future Riley translator later
  // populates body or contactId, replyable stays false until Riley opts in.
  const hasExpandableContent =
    (item.preview?.length ?? 0) > 0 ||
    (typeof item.body === "string" && item.body.length > 0) ||
    typeof item.contactId === "string";
  const expandable = item.replyable === true && hasExpandableContent;
  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <div
        style={{
          display: "grid",
          width: "100%",
          boxSizing: "border-box",
          gridTemplateColumns: compact ? "46px 96px 1fr 24px" : "54px 112px 1fr 28px",
          gap: compact ? 10 : 14,
          alignItems: "baseline",
          padding: "11px 0",
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: T.ink4,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {item.time}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 18,
            padding: "0 7px",
            borderRadius: 3,
            background: meta.bg,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: meta.color,
            textTransform: "uppercase",
            justifySelf: "start",
            whiteSpace: "nowrap",
          }}
        >
          {meta.pulse && <Dot color={meta.color} pulse size={5} />}
          {meta.label}
        </span>
        <span
          style={{
            fontSize: compact ? 13 : 13.5,
            lineHeight: 1.45,
            color: T.ink,
            display: "flex",
            gap: 8,
            alignItems: "baseline",
          }}
        >
          <span>{item.head}</span>
          {item.tag ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.ink4,
                fontFamily: "JetBrains Mono",
              }}
            >
              {item.tag}
            </span>
          ) : null}
        </span>
        {expandable ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={toggle}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: T.ink4,
              padding: "2px 6px",
            }}
          >
            {open ? "▴" : "▾"}
          </button>
        ) : (
          <span />
        )}
      </div>
      {open ? (
        <div style={{ padding: "0 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {item.body ? (
            <p style={{ fontSize: 13, lineHeight: 1.5, color: T.ink2, margin: 0 }}>{item.body}</p>
          ) : null}
          {item.preview && item.contactId && item.who ? (
            <ThreadPreview contactId={item.contactId} who={item.who} messages={item.preview} />
          ) : null}
          {item.who && item.contactId ? (
            <button
              type="button"
              onClick={() =>
                router.push(`/contacts/${encodeURIComponent(item.contactId!)}?note=open`)
              }
              style={{
                background: "transparent",
                border: "none",
                color: T.ink3,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "left",
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              Tell Alex about {firstName(item.who)}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
