// apps/dashboard/src/components/cockpit/composer-placeholder.tsx
import { T } from "./tokens";

export interface ComposerPlaceholderProps {
  halted: boolean;
  compact?: boolean;
  senderLabel?: string;
  placeholderCopy?: string;
  accentColor?: string;
}

export function ComposerPlaceholder({
  halted,
  compact = false,
  senderLabel = "ALEX",
  placeholderCopy = "Tell Alex what to do — coming soon",
  accentColor = T.ink4,
}: ComposerPlaceholderProps) {
  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 14px",
          opacity: halted ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: accentColor,
            letterSpacing: "0.08em",
          }}
        >
          → {senderLabel}
        </span>
        <span style={{ fontSize: 13, color: T.ink4, padding: "8px 0" }}>
          {halted ? "Halted — resume to send instructions" : placeholderCopy}
        </span>
      </div>
    </div>
  );
}
