"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AgentKey = "alex" | "nova" | "mira";

export interface AgentMeta {
  name: string;
  /**
   * HTML for the second half of the hero headline. Static, author-controlled
   * content only — never derive from user input. Rendered via
   * dangerouslySetInnerHTML in v6/hero.tsx.
   */
  head: string;
  cta: string;
  anchor: string;
}

export const AGENTS: Record<AgentKey, AgentMeta> = {
  alex: {
    name: "Alex",
    head: 'replies in twelve <em class="text-v6-coral not-italic">seconds</em>.',
    cta: "Alex",
    anchor: "#alex",
  },
  nova: {
    name: "Nova",
    head: 'catches what you <em class="text-v6-coral not-italic">miss</em>.',
    cta: "Nova",
    anchor: "#nova",
  },
  mira: {
    name: "Mira",
    head: 'ships what you <em class="text-v6-coral not-italic">can\'t</em>.',
    cta: "Mira",
    anchor: "#mira",
  },
};

const ORDER: AgentKey[] = ["alex", "nova", "mira"];
const STORAGE_KEY = "switchboard.landing.agent.v1";

interface Ctx {
  agent: AgentKey;
  setAgent: (key: AgentKey) => void;
  /** True once the user has interacted with a toggle. Stops auto-rotation. */
  userInteracted: boolean;
  /** Hero reports its visibility so we only auto-rotate when on screen. */
  setHeroInView: (v: boolean) => void;
}

const AgentCtx = createContext<Ctx | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgentState] = useState<AgentKey>("alex");
  const [userInteracted, setUserInteracted] = useState(false);
  const [heroInView, setHeroInView] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "alex" || saved === "nova" || saved === "mira") {
        setAgentState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const setAgent = useCallback((key: AgentKey) => {
    setAgentState(key);
    setUserInteracted(true);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (userInteracted || !heroInView) return;
    const id = window.setInterval(() => {
      setAgentState((current) => {
        const idx = ORDER.indexOf(current);
        return ORDER[(idx + 1) % ORDER.length];
      });
    }, 3200);
    return () => window.clearInterval(id);
  }, [userInteracted, heroInView]);

  const value = useMemo<Ctx>(
    () => ({ agent, setAgent, userInteracted, setHeroInView }),
    [agent, setAgent, userInteracted, setHeroInView],
  );

  return <AgentCtx.Provider value={value}>{children}</AgentCtx.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentCtx);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}
