import { SectionLabel } from "./section-label";

interface FunnelStage {
  name: string;
  count: number;
}
interface FunnelStripProps {
  stages: FunnelStage[];
  animate?: boolean;
}

export function FunnelStrip({ stages, animate: _animate }: FunnelStripProps) {
  return (
    <div>
      <SectionLabel>Pipeline</SectionLabel>
      <div
        style={{
          marginTop: "12px",
          background: "var(--sw-surface-raised)",
          border: "1px solid var(--sw-border)",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          alignItems: "center",
        }}
        className="flex-wrap gap-y-4"
      >
        {stages.map((stage, i) => (
          <div key={stage.name} style={{ flex: 1, minWidth: "100px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {i > 0 && (
                <span
                  style={{
                    color: "var(--sw-text-muted)",
                    fontSize: "14px",
                    marginRight: "12px",
                    opacity: 0.4,
                  }}
                >
                  ›
                </span>
              )}
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "24px",
                    fontWeight: 600,
                    color: "var(--sw-text-primary)",
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  {stage.count}
                </p>
                <p
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--sw-text-muted)",
                    marginTop: "6px",
                  }}
                >
                  {stage.name}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
