"use client";

import { type AgentKey, useAgent } from "./agent-context";

const ITEMS: { key: AgentKey; name: string; job: string }[] = [
  { key: "alex", name: "Alex", job: "lead reply" },
  { key: "nova", name: "Nova", job: "ad optimizer" },
  { key: "mira", name: "Mira", job: "creative" },
];

export function AgentToggle({ id, className = "" }: { id: string; className?: string }) {
  const { agent, setAgent } = useAgent();

  return (
    <div
      id={id}
      role="tablist"
      aria-label="Choose an agent"
      className={`relative inline-flex items-stretch gap-[0.4rem] rounded-full border border-[hsl(20_8%_14%_/_0.06)] bg-v6-cream-2 p-[0.4rem] shadow-[0_1px_0_hsl(20_12%_4%_/_0.03)] max-[640px]:flex-wrap max-[640px]:justify-center ${className}`}
    >
      {ITEMS.map((it) => {
        const active = agent === it.key;
        return (
          <button
            key={it.key}
            type="button"
            data-agent={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => setAgent(it.key)}
            className={`relative inline-flex items-center gap-[0.55rem] whitespace-nowrap rounded-full px-[1.1rem] py-[0.7rem] pl-[0.8rem] text-[0.9375rem] tracking-[-0.005em] transition-colors duration-200 max-[640px]:gap-[0.4rem] max-[640px]:px-[0.85rem] max-[640px]:py-[0.55rem] max-[640px]:pl-[0.65rem] max-[640px]:text-[0.85rem] ${
              active
                ? "bg-v6-graphite text-v6-cream hover:bg-black"
                : "text-v6-graphite hover:bg-[hsl(20_8%_14%_/_0.05)]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center max-[640px]:h-[18px] max-[640px]:w-[18px] ${
                active ? "text-v6-cream" : "text-v6-graphite"
              }`}
            >
              <svg viewBox="0 0 48 48" className="block h-full w-full">
                <use href={`#mark-${it.key}`} />
              </svg>
            </span>
            <span className={`font-medium ${active ? "text-v6-cream" : "text-v6-graphite"}`}>
              {it.name}
            </span>
            <span
              className={`font-mono-v6 text-[10px] font-medium uppercase tracking-[0.06em] max-[640px]:hidden ${
                active ? "text-v6-coral" : "text-v6-graphite-2"
              }`}
            >
              {it.job}
            </span>
          </button>
        );
      })}
    </div>
  );
}
