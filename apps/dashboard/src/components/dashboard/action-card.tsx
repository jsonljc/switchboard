import { formatRelative } from "@/lib/format";

interface ActionCardAction {
  label: string;
  variant: "primary" | "secondary";
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface ActionCardProps {
  summary: string;
  context: string | null;
  createdAt: string;
  actions: ActionCardAction[];
}

export function ActionCard({ summary, context, createdAt, actions }: ActionCardProps) {
  return (
    <div
      style={{
        background: "var(--sw-surface-raised)",
        border: "1px solid var(--sw-border)",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <p style={{ fontSize: "16px", color: "var(--sw-text-primary)", margin: 0 }}>{summary}</p>
      {context && (
        <p style={{ fontSize: "14px", color: "var(--sw-text-secondary)", marginTop: "6px" }}>
          {context}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "12px" }}>
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className="active:scale-[0.98]"
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: action.disabled ? "not-allowed" : "pointer",
              opacity: action.disabled ? 0.5 : 1,
              transition: "opacity 200ms ease-out, transform 200ms ease-out",
              ...(action.variant === "primary"
                ? { background: "var(--sw-accent)", color: "white" }
                : { background: "transparent", color: "var(--sw-text-secondary)" }),
            }}
          >
            {action.loading ? "..." : action.label}
          </button>
        ))}
        <time style={{ marginLeft: "auto", fontSize: "13px", color: "var(--sw-text-muted)" }}>
          {formatRelative(createdAt)}
        </time>
      </div>
    </div>
  );
}
