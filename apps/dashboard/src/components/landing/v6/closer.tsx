"use client";

import { ArrowSig } from "./glyphs";
import { AGENTS, useAgent } from "./agent-context";
import { AgentToggle } from "./agent-toggle";

export function V6Closer() {
  const { agent } = useAgent();
  const meta = AGENTS[agent];

  return (
    <section
      id="closer"
      data-screen-label="08 Closer"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-36 text-center max-[900px]:py-24"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>08 — Hire your first agent</span>
          </span>
          <span>Live in a day</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mx-auto flex max-w-[64rem] flex-col items-center">
          <h2
            className="text-balance font-semibold leading-[1.0] tracking-[-0.025em] text-v6-graphite"
            style={{ fontSize: "clamp(2.5rem, 6.4vw, 5.6rem)" }}
          >
            Hire your first agent.
            <span className="mt-[0.15em] block font-normal text-v6-graphite-2">
              <em className="font-semibold not-italic text-v6-coral">Live</em> in a day.
            </span>
          </h2>

          <p className="mx-auto mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
            Pick the seat that hurts most. Add another when ready. Agents draft, you publish — from
            day one.
          </p>

          <AgentToggle id="closer-toggle" className="mt-10" />

          <div className="mt-9 flex flex-wrap items-center justify-center gap-6">
            <a
              href={meta.anchor}
              className="inline-flex items-center gap-[0.65rem] whitespace-nowrap rounded-full bg-v6-graphite px-7 py-[1.05rem] pl-[1.85rem] text-[0.95rem] font-medium tracking-[-0.005em] text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] transition-[transform,background-color,box-shadow] duration-[250ms] hover:-translate-y-px hover:bg-black hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
            >
              Start with <span className="font-medium">{meta.name}</span>
              <ArrowSig className="!h-[0.7rem] !w-[1.05rem]" />
            </a>
            <a
              href="#pricing"
              className="inline-flex items-center gap-[0.4rem] border-b border-[hsl(20_8%_14%_/_0.12)] pb-[0.2rem] text-[0.95rem] font-medium text-v6-graphite hover:border-v6-graphite"
            >
              Or meet the desk
              <ArrowSig className="!h-[0.55rem] !w-[0.9rem]" />
            </a>
          </div>

          <span className="font-mono-v6 mt-10 text-[11px] tracking-[0.08em] text-v6-graphite-3">
            Pilot access · Cancel anytime
          </span>
        </div>
      </div>
    </section>
  );
}
