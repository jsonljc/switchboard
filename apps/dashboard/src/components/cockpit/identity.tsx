// apps/dashboard/src/components/cockpit/identity.tsx
import { T } from "./tokens";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config";
import { StatusPill } from "./status-pill";
import type { CockpitStatus } from "./types";

export interface IdentityProps {
  statusKey: CockpitStatus;
  halted: boolean;
  subtitle: string;
  line: string | null;
  /** Click handler for the Halt / Resume button. Receives no argument. */
  onHaltToggle: () => void;
  compact?: boolean;
  /** A.2: when both this and onOpenMission are set, the subtitle becomes a
   * clickable mission-popover trigger (subtle underline hover). Otherwise
   * it renders as plain text (A.1 default). */
  missionInteractive?: boolean;
  /** A.2: called when the operator clicks the interactive subtitle. */
  onOpenMission?: () => void;
}

function AvatarFrame({ size = 64 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.18),
        background: ALEX_CONFIG.accent.soft,
        border: `1px solid ${T.hair}`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
        overflow: "hidden",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: size * 0.42, color: ALEX_CONFIG.accent.deep }}>
        {ALEX_CONFIG.name[0]}
      </span>
    </div>
  );
}

export function Identity({
  statusKey,
  halted,
  subtitle,
  line,
  onHaltToggle,
  compact = false,
  missionInteractive = false,
  onOpenMission,
}: IdentityProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: compact ? 12 : 16,
        padding: compact ? "18px 18px 14px" : "24px 28px 18px",
      }}
    >
      <AvatarFrame size={compact ? 52 : 64} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: compact ? 18 : 22,
              fontWeight: 600,
              color: T.ink,
              letterSpacing: "-0.015em",
            }}
          >
            {ALEX_CONFIG.name}
          </span>
          <StatusPill statusKey={statusKey} halted={halted} />
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: T.ink3,
            fontFamily: "JetBrains Mono",
            letterSpacing: "0.02em",
          }}
        >
          {missionInteractive && onOpenMission ? (
            <button
              type="button"
              onClick={onOpenMission}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: "inherit",
                color: "inherit",
                fontFamily: "inherit",
                letterSpacing: "inherit",
                textDecoration: "none",
              }}
              className="text-left underline-offset-2 hover:underline"
            >
              {subtitle}
            </button>
          ) : (
            subtitle
          )}
        </div>
        {line && (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: compact ? 13.5 : 14,
              lineHeight: 1.5,
              color: T.ink2,
              maxWidth: 640,
            }}
          >
            {line}
          </p>
        )}
      </div>
      <button
        onClick={onHaltToggle}
        style={{
          background: "transparent",
          border: `1px solid ${T.hair}`,
          padding: "6px 12px",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 600,
          color: halted ? T.green : T.red,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontFamily: "inherit",
        }}
      >
        {halted ? "▶ Resume" : "⏸ Halt"}
      </button>
    </div>
  );
}
