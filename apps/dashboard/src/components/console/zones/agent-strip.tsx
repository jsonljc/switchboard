"use client";

import Link from "next/link";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useModuleStatus } from "@/hooks/use-module-status";
import { ZoneError, ZoneSkeleton } from "./zone-states";

type AgentEntry = {
  key: "alex" | "nova" | "mira";
  name: string;
  active: boolean;
  viewLink: { label: string; href: string };
};

const AGENTS: ReadonlyArray<{
  key: AgentEntry["key"];
  name: string;
  moduleId: "lead-to-booking" | "ad-optimizer" | "creative";
}> = [
  { key: "alex", name: "Alex", moduleId: "lead-to-booking" },
  { key: "nova", name: "Nova", moduleId: "ad-optimizer" },
  { key: "mira", name: "Mira", moduleId: "creative" },
];

export function AgentStrip() {
  const roster = useAgentRoster();
  const state = useAgentState();
  const modules = useModuleStatus();

  if (roster.isLoading || state.isLoading || modules.isLoading) {
    return <ZoneSkeleton label="Loading agents" />;
  }

  if (roster.error || state.error || modules.error) {
    return (
      <ZoneError
        message="Couldn't load agents."
        onRetry={() => {
          roster.refetch();
          state.refetch();
          modules.refetch();
        }}
      />
    );
  }

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  const moduleEnabled = (id: string) => moduleList.some((m) => m.id === id && m.state === "live");

  const enabledMap = {
    alex: moduleEnabled("lead-to-booking"),
    nova: moduleEnabled("ad-optimizer"),
    mira: moduleEnabled("creative"),
  };
  // Match prior fixture default: Nova active when ad-optimizer live, else first live agent.
  const activeKey: AgentEntry["key"] = enabledMap.nova ? "nova" : enabledMap.alex ? "alex" : "mira";

  // Per-agent today-stats are Option-C territory; render a muted em-dash here
  // (DC-02: replaces the literal "pending option C" jargon at the render site).
  // Per-module deep-link is post-launch backlog; default all to /conversations.
  const agents: AgentEntry[] = AGENTS.map((a) => ({
    key: a.key,
    name: a.name,
    active: a.key === activeKey,
    viewLink: { label: "view conversations →", href: "/conversations" },
  }));

  return (
    <section className="zone3" aria-label="Agents">
      <div className="zone-head">
        <span className="label">Agents</span>
      </div>

      <div className="agent-strip">
        {agents.map((a) => (
          <button
            key={a.key}
            className={`agent-col${a.active ? " active" : ""}`}
            type="button"
            aria-pressed={a.active ? "true" : undefined}
            aria-label={a.active ? `${a.name} panel open` : `Open ${a.name} panel`}
          >
            <span className="a-name">{a.name}</span>
            <span className="a-stat muted">—</span>
            <span className="a-sub muted">—</span>
            <Link className="a-view" href={a.viewLink.href} onClick={(e) => e.stopPropagation()}>
              {a.viewLink.label}
            </Link>
          </button>
        ))}
      </div>
    </section>
  );
}
