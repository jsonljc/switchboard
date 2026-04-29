"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSig } from "./glyphs";
import { AGENTS, useAgent } from "./agent-context";
import { AgentToggle } from "./agent-toggle";

export function V6Hero() {
  const { agent, setHeroInView } = useAgent();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [displayed, setDisplayed] = useState(agent);

  // Crossfade headline when the active agent changes.
  useEffect(() => {
    if (displayed === agent) return;
    setSwapping(true);
    const t = window.setTimeout(() => {
      setDisplayed(agent);
      setSwapping(false);
    }, 220);
    return () => window.clearTimeout(t);
  }, [agent, displayed]);

  // Tell the provider whether the hero is on screen — auto-rotate is gated on it.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setHeroInView(e.isIntersecting);
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [setHeroInView]);

  const meta = AGENTS[displayed];

  return (
    <section
      ref={sectionRef}
      id="hero"
      data-screen-label="01 Hero"
      className="v6-hero-bg relative overflow-hidden pt-[9.5rem] pb-20 text-center max-[900px]:pt-[7.5rem] max-[900px]:pb-16"
    >
      {/* Beat frame (mono labels at top corners) */}
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>01 — Meet the desk</span>
          </span>
          <span>Switchboard / always on</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="relative z-[1] mx-auto flex w-full max-w-[60rem] flex-col items-center">
          <span className="v6-hero-eyebrow font-mono-v6 mb-8 inline-flex items-center gap-[0.6rem] text-[11px] tracking-[0.1em] text-v6-graphite-3">
            A revenue desk you hire one seat at a time
          </span>

          <h1
            className={`v6-h-swap mx-auto max-w-[18ch] text-balance font-semibold leading-[1.0] tracking-[-0.025em] text-v6-graphite ${
              swapping ? "swapping" : ""
            }`}
            style={{ fontSize: "clamp(2.6rem, 6.4vw, 5.6rem)" }}
          >
            <span className="v6-h-name">{meta.name}</span>
            <span className="v6-h-rest" dangerouslySetInnerHTML={{ __html: meta.head }} />
          </h1>

          <p className="mx-auto mt-7 max-w-[36rem] text-[1.125rem] leading-[1.5] text-v6-graphite-2">
            Hire one. Or hire the desk —{" "}
            <b className="font-medium text-v6-graphite">they share context as they go.</b>
          </p>

          <AgentToggle id="hero-toggle" className="mt-10" />

          <div className="mt-9 flex flex-wrap items-center justify-center gap-6">
            <a
              href={meta.anchor}
              className="inline-flex items-center gap-[0.65rem] whitespace-nowrap rounded-full bg-v6-graphite px-7 py-[1.05rem] pl-[1.85rem] text-[0.95rem] font-medium tracking-[-0.005em] text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] transition-[transform,background-color,box-shadow] duration-[250ms] hover:-translate-y-px hover:bg-black hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
            >
              See {meta.name} work
              <ArrowSig className="!h-[0.7rem] !w-[1.05rem]" />
            </a>
            <a
              href="#synergy"
              className="inline-flex items-center gap-[0.4rem] border-b border-[hsl(20_8%_14%_/_0.12)] pb-[0.2rem] text-[0.95rem] font-medium text-v6-graphite transition-colors duration-200 hover:border-v6-graphite"
            >
              Or meet the desk
              <ArrowSig className="!h-[0.55rem] !w-[0.9rem]" />
            </a>
          </div>

          <span className="font-mono-v6 mt-11 text-[11px] tracking-[0.08em] text-v6-graphite-3">
            Setup in a day · Agents draft, you publish · Stays in your control
          </span>
        </div>
      </div>
    </section>
  );
}
