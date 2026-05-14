// apps/dashboard/src/components/cockpit/activity-row.tsx
import { T } from "./tokens";
import { lookupKindMeta } from "./kind-meta";
import { Dot } from "./dot";
import type { ActivityRow as ActivityRowType } from "./types";

export interface ActivityRowProps {
  item: ActivityRowType;
  open: boolean;
  toggle: () => void;
  compact?: boolean;
}

export function ActivityRow({
  item,
  open: _open,
  toggle: _toggle,
  compact = false,
}: ActivityRowProps) {
  const meta = lookupKindMeta(item.kind);
  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <div
        style={{
          display: "grid",
          width: "100%",
          boxSizing: "border-box",
          gridTemplateColumns: compact ? "46px 96px 1fr" : "54px 112px 1fr",
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
        <span style={{ fontSize: compact ? 13 : 13.5, lineHeight: 1.45, color: T.ink }}>
          {item.head}
        </span>
      </div>
    </li>
  );
}
