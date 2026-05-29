"use client";

import { AGENT_KEYS, AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";
import { InboxAgentAvatar } from "./inbox-agent-avatar";

export interface InboxFilterCounts {
  /** Total unfiltered queue size (the "All" chip count). */
  total: number;
}

export interface InboxFilterRowProps {
  /** Per-agent counts plus a total. Agents absent from the map count as 0. */
  counts: InboxFilterCounts & Partial<Record<AgentKey, number>>;
  /** Currently selected agent, or null for "All". */
  selected: AgentKey | null;
  onSelect: (key: AgentKey | null) => void;
}

interface FilterChipProps {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
  /** Agent identity for the sprite avatar; omitted for the "All" chip. */
  agentKey?: AgentKey;
}

function FilterChip({ label, count, pressed, onClick, agentKey }: FilterChipProps) {
  return (
    <button
      type="button"
      className="filter-chip"
      data-agent={agentKey ?? "all"}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {agentKey ? (
        <span className="filter-chip-sprite">
          <InboxAgentAvatar agentKey={agentKey} size={26} />
        </span>
      ) : (
        <span className="filter-chip-dot" />
      )}
      <span>{label}</span>
      <span className="filter-chip-count">{count}</span>
    </button>
  );
}

/**
 * Presentational teammate filter (design: inbox-v2 `.filter-chip`). Renders an
 * "All" chip plus one chip per agent. Honesty rule: a `day-one` agent (Alex,
 * Riley) always shows; a `day-thirty` agent (Mira) shows ONLY when its count is
 * > 0. Agent color is identity-only (the avatar/dot), never the chip fill.
 */
export function InboxFilterRow({ counts, selected, onSelect }: InboxFilterRowProps) {
  return (
    <div className="inbox-filter" role="group" aria-label="Filter by teammate">
      <FilterChip
        label="All"
        count={counts.total}
        pressed={selected === null}
        onClick={() => onSelect(null)}
      />
      {AGENT_KEYS.map((key) => {
        const count = counts[key] ?? 0;
        const isDayOne = AGENT_REGISTRY[key].launchTier === "day-one";
        if (!isDayOne && count <= 0) return null;
        return (
          <FilterChip
            key={key}
            agentKey={key}
            label={AGENT_REGISTRY[key].displayName}
            count={count}
            pressed={selected === key}
            onClick={() => onSelect(key)}
          />
        );
      })}
    </div>
  );
}
