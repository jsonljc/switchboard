// apps/dashboard/src/components/cockpit/approval-card.tsx
import { T, type AccentTokens } from "./tokens";
import type { ApprovalView } from "./types";

// `ApprovalAccent` is retained as an alias for the shared `AccentTokens`
// shape (originally introduced by this component in B.3; B.2b promoted it to
// `tokens.ts` so <ROIBar> / <KPIStrip> can reuse the same shape).
export type ApprovalAccent = AccentTokens;

export const ALEX_APPROVAL_ACCENT: AccentTokens = {
  base: T.amber,
  deep: T.amberDeep,
  soft: T.amberSoft,
  paper: T.amberPaper,
};

export interface ApprovalCardProps {
  data: ApprovalView;
  idx: number;
  total: number;
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
  accent?: ApprovalAccent;
  senderLabel?: string;
}

export function ApprovalCard({
  data,
  idx,
  total,
  onResolve,
  compact = false,
  accent = ALEX_APPROVAL_ACCENT,
  senderLabel = "Alex needs you",
}: ApprovalCardProps) {
  return (
    <section
      style={{
        padding: compact ? "16px 18px" : "20px 22px",
        background: accent.paper,
        borderRadius: 8,
        border: `1px solid ${accent.soft}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: accent.deep,
            textTransform: "uppercase",
          }}
        >
          {senderLabel}
        </span>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: accent.deep }}>
          · {data.askedAt}
        </span>
        {total > 1 && (
          <>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 11,
                color: accent.deep,
                fontWeight: 600,
              }}
            >
              {idx + 1} of {total}
            </span>
          </>
        )}
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: compact ? 17 : 19,
          fontWeight: 600,
          color: T.ink,
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
        }}
      >
        {data.title}
      </h2>
      {data.body && (
        <p
          style={{
            margin: "8px 0 0",
            maxWidth: 640,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: T.ink2,
          }}
        >
          {data.body}
        </p>
      )}
      {data.quote && (
        <div
          style={{
            margin: "12px 0 0",
            padding: "10px 14px",
            background: "rgba(255,255,255,0.55)",
            borderRadius: 4,
            border: `1px solid ${accent.soft}`,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: T.ink2,
          }}
        >
          <span style={{ color: accent.base, fontWeight: 600, marginRight: 3 }}>"</span>
          {data.quote}
          <span style={{ color: accent.base, fontWeight: 600, marginLeft: 3 }}>"</span>
          {data.quoteFrom && (
            <div
              style={{ marginTop: 4, fontFamily: "JetBrains Mono", fontSize: 10.5, color: T.ink4 }}
            >
              — {data.quoteFrom}
            </div>
          )}
        </div>
      )}
      {data.risk && (
        <div
          style={{
            marginTop: 10,
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: accent.deep,
            letterSpacing: "0.04em",
          }}
        >
          ⚠ {data.risk}
        </div>
      )}
      <div
        style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
      >
        <button
          onClick={() => onResolve("accept", idx)}
          style={{
            background: accent.base,
            color: "#fff",
            border: `1px solid ${accent.deep}`,
            padding: "8px 16px",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {data.primary}
        </button>
        <button
          onClick={() => onResolve("decline", idx)}
          style={{
            background: "#fff",
            color: T.ink,
            border: `1px solid ${T.hair}`,
            padding: "8px 14px",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {data.secondary}
        </button>
      </div>
    </section>
  );
}
