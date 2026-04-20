"use client";

import { FadeIn } from "@/components/ui/fade-in";

interface BeforeAfterStripProps {
  title: string;
  before: {
    visual: React.ReactNode;
    copy: string;
  };
  after: {
    visual: React.ReactNode;
    copy: string;
    microDetail: string;
    outcomeTag: string;
  };
}

export function BeforeAfterStrip({ title, before, after }: BeforeAfterStripProps) {
  return (
    <div style={{ paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "#7A736C",
          marginBottom: "1.25rem",
        }}
      >
        {title}
      </p>
      <div
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: "1.5rem", alignItems: "start" }}
      >
        {/* Before */}
        <FadeIn>
          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "1rem",
              padding: "1.5rem",
              opacity: 0.7,
            }}
          >
            <div style={{ marginBottom: "1rem" }}>{before.visual}</div>
            <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#7A736C" }}>
              {before.copy}
            </p>
          </div>
        </FadeIn>

        {/* After */}
        <FadeIn delay={150}>
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "1rem",
              padding: "1.5rem",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>{after.visual}</div>
            <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#EDE8E1" }}>{after.copy}</p>
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "#7A736C",
              }}
            >
              {after.microDetail}
            </p>
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "#A07850",
              }}
            >
              {after.outcomeTag}
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
