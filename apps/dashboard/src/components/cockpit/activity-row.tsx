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

const linkButtonStyle = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  color: T.ink3,
  padding: 0,
  textDecoration: "underline",
  textDecorationColor: "rgba(14,12,10,0.15)",
  textUnderlineOffset: 3,
  fontFamily: "inherit",
} as const;

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
  // When expandable, the whole row is a single click target. When not, render
  // as a div so the row's accessible name (which includes the kind pill text,
  // e.g. "BOOKED Maya R. confirmed") doesn't shadow other buttons matching
  // those keywords (filter chips, command palette entries).
  const RowTag = expandable ? "button" : "div";
  const rowProps = expandable
    ? ({
        type: "button" as const,
        onClick: () => toggle(),
        "aria-expanded": open,
        "aria-label": open ? "Collapse" : "Expand",
      } as const)
    : ({} as const);

  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <RowTag
        {...rowProps}
        style={{
          all: "unset",
          display: "grid",
          width: "100%",
          boxSizing: "border-box",
          gridTemplateColumns: compact ? "46px 96px 1fr 16px" : "54px 112px 1fr auto",
          gap: compact ? 10 : 14,
          alignItems: "baseline",
          padding: "11px 0",
          cursor: expandable ? "pointer" : "default",
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
        <span
          aria-hidden="true"
          style={{
            color: T.ink4,
            fontSize: 14,
            fontFamily: "JetBrains Mono",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform .15s ease",
            width: 14,
            textAlign: "center",
          }}
        >
          {expandable ? "›" : ""}
        </span>
      </RowTag>
      {open ? (
        <div style={{ padding: compact ? "2px 0 14px 60px" : "2px 0 16px 76px" }}>
          {item.body ? (
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: T.ink2,
                margin: 0,
                maxWidth: 600,
              }}
            >
              {item.body}
            </p>
          ) : null}
          {item.preview && item.contactId && item.who ? (
            <ThreadPreview contactId={item.contactId} who={item.who} messages={item.preview} />
          ) : null}
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {item.contactId ? (
              <button
                type="button"
                onClick={() => router.push(`/contacts/${encodeURIComponent(item.contactId!)}`)}
                style={linkButtonStyle}
              >
                Open full thread →
              </button>
            ) : null}
            {item.who && item.contactId ? (
              <button
                type="button"
                onClick={() =>
                  router.push(`/contacts/${encodeURIComponent(item.contactId!)}?note=open`)
                }
                style={linkButtonStyle}
              >
                Tell Alex about {firstName(item.who)}
              </button>
            ) : null}
            {item.who && item.contactId ? (
              <button
                type="button"
                onClick={() =>
                  router.push(`/contacts/${encodeURIComponent(item.contactId!)}?takeover=true`)
                }
                style={linkButtonStyle}
              >
                I&apos;ll reply to {firstName(item.who)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
