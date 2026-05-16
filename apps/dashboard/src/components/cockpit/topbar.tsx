// apps/dashboard/src/components/cockpit/topbar.tsx
import Link from "next/link";
import { T } from "./tokens";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config";

export interface TopbarTab {
  name: string;
  active?: boolean;
  muted?: boolean;
  /**
   * Route the tab navigates to when clicked. When omitted, the tab renders
   * as a non-routing span (used for tabs whose route doesn't exist yet,
   * e.g. Mira). Tabs with `href` render as a `next/link` for client-side nav.
   */
  href?: string;
}

export interface TopbarProps {
  /**
   * Whether the command-palette affordance is wired. A.1 ships `false`
   * (palette UI lands at A.5). When false, the "Tell Alex…" button renders
   * disabled with no click handler — keyboard shortcuts also do not register.
   */
  paletteEnabled: boolean;
  /** Optional click handler invoked when paletteEnabled is true. */
  onOpenPalette?: () => void;
  compact?: boolean;
  /** Per-route tab list. Defaults to `ALEX_CONFIG.tabs` for backward compat. */
  tabs?: readonly TopbarTab[];
  /**
   * Label rendered on the palette-affordance button. Defaults to "Tell Alex…"
   * so Alex's cockpit-page need not pass this prop. Riley passes "Tell Riley…".
   */
  paletteLabel?: string;
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill={T.ink} />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path
        d="M 7 11 Q 11 6.5, 15 11"
        stroke={T.amber}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Tab({
  name,
  active,
  muted,
  href,
}: {
  name: string;
  active?: boolean;
  muted?: boolean;
  href?: string;
}) {
  const style = {
    padding: "5px 10px",
    borderRadius: 4,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? T.ink : muted ? T.ink4 : T.ink3,
    background: active ? "rgba(14,12,10,0.05)" : "transparent",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as const;
  if (href) {
    return (
      <Link href={href} style={style}>
        {name}
      </Link>
    );
  }
  return <span style={style}>{name}</span>;
}

export function Topbar({
  paletteEnabled,
  onOpenPalette,
  compact = false,
  tabs = ALEX_CONFIG.tabs,
  paletteLabel = "Tell Alex…",
}: TopbarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: compact ? "12px 18px" : "14px 28px",
        borderBottom: `1px solid ${T.hair}`,
        background: T.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 14 : 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark />
          {!compact && (
            <span
              style={{ fontWeight: 600, fontSize: 14, color: T.ink, letterSpacing: "-0.005em" }}
            >
              Switchboard
            </span>
          )}
        </div>
        <nav style={{ display: "flex", gap: 2 }}>
          {tabs.map((t) => (
            <Tab
              key={t.name}
              name={t.name}
              active={t.active ?? false}
              muted={t.muted ?? false}
              href={t.href}
            />
          ))}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 12 }}>
        <button
          onClick={paletteEnabled ? onOpenPalette : undefined}
          disabled={!paletteEnabled}
          aria-disabled={!paletteEnabled}
          title={paletteEnabled ? undefined : "Coming soon"}
          style={{
            background: "transparent",
            border: `1px solid ${T.hair}`,
            padding: "5px 10px 5px 12px",
            borderRadius: 4,
            cursor: paletteEnabled ? "pointer" : "default",
            opacity: paletteEnabled ? 1 : 0.55,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 12.5, color: T.ink3 }}>{paletteLabel}</span>
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10.5,
              color: T.ink4,
              padding: "1px 5px",
              border: `1px solid ${T.hair}`,
              borderRadius: 3,
            }}
          >
            ⌘K
          </span>
        </button>
        {!compact && (
          <Link
            href="/settings"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              color: T.ink3,
              fontWeight: 500,
              padding: "6px 8px",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            Settings
          </Link>
        )}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: T.ink,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          M
        </div>
      </div>
    </header>
  );
}
