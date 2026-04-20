"use client";

import Link from "next/link";
import { useState } from "react";
import { AgentMark, SLUG_TO_AGENT } from "@/components/character/agent-mark";
import type { AgentId } from "@/components/character/agent-mark";

interface PreviewAgent {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
}

interface HeroCardClusterProps {
  agents: PreviewAgent[];
}

function MiniCard({
  agent,
  style,
  dimmed,
}: {
  agent: PreviewAgent;
  style?: React.CSSProperties;
  dimmed?: boolean;
}) {
  const agentId: AgentId = SLUG_TO_AGENT[agent.slug] ?? "alex";

  return (
    <div
      style={{
        width: "17rem",
        background: "#F9F8F6",
        border: "1px solid #C8C3BC",
        borderRadius: "1.25rem",
        padding: "1.5rem",
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1rem" }}>
        <AgentMark agent={agentId} size="lg" />
      </div>
      <h3
        style={{
          fontSize: "1.125rem",
          fontWeight: 700,
          letterSpacing: "-0.015em",
          color: dimmed ? "#9C958F" : "#1A1714",
          margin: 0,
        }}
      >
        {agent.name}
      </h3>
      {!dimmed && (
        <>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.8125rem",
              lineHeight: 1.55,
              color: "#6B6560",
            }}
          >
            {agent.description}
          </p>
          <div
            style={{
              marginTop: "1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
            }}
          >
            <div
              style={{
                width: "2rem",
                height: "2rem",
                borderRadius: "9999px",
                background: "rgba(160,120,80,0.1)",
                border: "1.5px solid rgba(160,120,80,0.38)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#A07850",
              }}
            >
              {agent.trustScore}
            </div>
            <span style={{ fontSize: "0.8125rem", color: "#9C958F" }}>trust score</span>
          </div>
          <Link
            href={`/agents/${agent.slug}`}
            style={{
              display: "block",
              marginTop: "1.25rem",
              padding: "0.625rem 1rem",
              background: "#EDEAE5",
              border: "1px solid #DDD9D3",
              borderRadius: "9999px",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "#1A1714",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Learn more →
          </Link>
        </>
      )}
    </div>
  );
}

export function HeroCardCluster({ agents }: HeroCardClusterProps) {
  const [hovered, setHovered] = useState(false);
  const [primary, second, third] = agents;

  return (
    <div
      style={{ position: "relative", width: "22rem", overflow: "visible" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Back card — right */}
      {third && (
        <div
          className="hidden md:block"
          style={{
            position: "absolute",
            top: 0,
            left: "calc(50% - 8.5rem)",
            zIndex: 1,
            opacity: 0.7,
            transform: hovered
              ? "rotate(4deg) translate(3.5rem, 1.25rem)"
              : "rotate(3deg) translate(2.5rem, 1rem)",
            transition: "transform 300ms ease, opacity 300ms ease",
            pointerEvents: "none",
          }}
        >
          <MiniCard agent={third} dimmed />
        </div>
      )}

      {/* Back card — left */}
      {second && (
        <div
          className="hidden md:block"
          style={{
            position: "absolute",
            top: 0,
            left: "calc(50% - 8.5rem)",
            zIndex: 2,
            opacity: 0.85,
            transform: hovered
              ? "rotate(-3deg) translate(-3.5rem, 0.75rem)"
              : "rotate(-2deg) translate(-2.5rem, 0.5rem)",
            transition: "transform 300ms ease, opacity 300ms ease",
            pointerEvents: "none",
          }}
        >
          <MiniCard agent={second} dimmed />
        </div>
      )}

      {/* Primary card — foreground */}
      {primary && (
        <div
          style={{
            position: "relative",
            zIndex: 3,
            margin: "0 auto",
            transform: hovered ? "rotate(0deg)" : "rotate(1.5deg)",
            boxShadow: hovered
              ? "0 20px 56px rgba(26,23,20,0.13)"
              : "0 16px 48px rgba(26,23,20,0.10)",
            transition: "transform 300ms ease, box-shadow 300ms ease",
            borderRadius: "1.25rem",
          }}
        >
          <MiniCard agent={primary} />
        </div>
      )}
    </div>
  );
}
