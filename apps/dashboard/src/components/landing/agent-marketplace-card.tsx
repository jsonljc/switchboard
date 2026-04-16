import Link from "next/link";
import { AgentMark, SLUG_TO_AGENT } from "@/components/character/agent-mark";
import type { AgentId } from "@/components/character/agent-mark";

interface AgentMarketplaceCardProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  stats: {
    totalTasks: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  className?: string;
}

export function AgentMarketplaceCard({
  name,
  slug,
  description,
  trustScore,
  autonomyLevel,
  className,
}: AgentMarketplaceCardProps) {
  const agent: AgentId = SLUG_TO_AGENT[slug] ?? "alex";

  return (
    <div
      className={className}
      style={{
        background: "#F9F8F6",
        border: "1px solid #DDD9D3",
        borderRadius: "1rem",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 150ms ease, transform 150ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#C8C3BC";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#DDD9D3";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      {/* Character mark + category */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <AgentMark agent={agent} size="sm" />
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#9C958F",
          }}
        >
          {autonomyLevel}
        </span>
      </div>

      {/* Name */}
      <h3
        style={{
          fontWeight: 700,
          fontSize: "1.125rem",
          letterSpacing: "-0.015em",
          color: "#1A1714",
          margin: 0,
        }}
      >
        {name}
      </h3>

      {/* Description */}
      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.875rem",
          lineHeight: 1.55,
          color: "#6B6560",
          flex: 1,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {description}
      </p>

      {/* Trust score */}
      <div
        style={{
          marginTop: "1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: "1.875rem",
              height: "1.875rem",
              borderRadius: "9999px",
              background: "rgba(160,120,80,0.1)",
              border: "1.5px solid rgba(160,120,80,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6875rem",
              fontWeight: 700,
              color: "#A07850",
            }}
          >
            {trustScore}
          </div>
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>trust score</span>
        </div>

        <Link
          href={`/agents/${slug}`}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#1A1714",
            textDecoration: "none",
          }}
        >
          Learn more →
        </Link>
      </div>
    </div>
  );
}
