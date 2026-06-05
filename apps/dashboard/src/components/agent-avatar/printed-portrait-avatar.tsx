// apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { AnimatedSprite } from "@/components/cockpit/sprite/animated-sprite";
import type { SpriteVariantKey, VariantBundle } from "@/components/cockpit/sprite/types";
import { ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
import { RILEY_VARIANTS, DEFAULT_RILEY_VARIANT } from "@/lib/cockpit/riley/riley-config";
import { MIRA_VARIANTS, DEFAULT_MIRA_VARIANT } from "@/lib/cockpit/mira/mira-config";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { agentVisualState, type AgentActivity } from "./agent-status-visual";
import styles from "./printed-portrait-avatar.module.css";

interface SpriteRef {
  bundle: VariantBundle | null;
  /** Sprite variant within the bundle. A `null` bundle is the no-sprite signal;
   *  all three agents (Alex/Riley/Mira) now ship a real sprite. */
  variant?: SpriteVariantKey;
}

/** Every agent now has a real 24x24 pixel sprite (Alex/Riley/Mira). */
const SPRITES: Record<AgentKey, SpriteRef> = {
  alex: { bundle: ALEX_VARIANTS, variant: DEFAULT_ALEX_VARIANT },
  riley: { bundle: RILEY_VARIANTS, variant: DEFAULT_RILEY_VARIANT },
  mira: { bundle: MIRA_VARIANTS, variant: DEFAULT_MIRA_VARIANT },
};

/** Explicit per-agent class map: Record<AgentKey> forces an entry when AgentKey grows, keeping agent styling centralized. */
const AGENT_CLASS: Record<AgentKey, string> = {
  alex: styles.alex,
  riley: styles.riley,
  mira: styles.mira,
};

/** Decorative one-letter fallback. No agent reaches this today (all three ship a
 *  sprite); the `Record<AgentKey>` keeps an entry per agent so a future
 *  sprite-less agent degrades to its identity letter instead of an empty plate. */
const AGENT_LETTER: Record<AgentKey, string> = {
  alex: "A",
  riley: "R",
  mira: "M",
};

export interface PrintedPortraitAvatarProps {
  agentKey: AgentKey;
  /** Box size in px (chip ~22-44) or "fill" (fluid, parent-controlled; hero poster). Default 28. */
  size?: number | "fill";
  /** Hero frame variant: heavier 2px halo offset + 1.5px edge + capped pip (spec section 4). */
  hero?: boolean;
  /** Live activity. Default "idle" (static). */
  status?: AgentActivity;
  /** Workspace halt. Overrides status -> sleeping. Default false. */
  halted?: boolean;
  /** Show the status pip. Default true. */
  showPip?: boolean;
  /**
   * Whether this avatar may animate. Default true. Callers enforce the
   * one-breathing-avatar-per-viewport budget by passing false to all but the
   * single focal (e.g. first working) agent.
   */
  allowMotion?: boolean;
  className?: string;
}

/**
 * The one agent avatar for every surface: the agent's pixel sprite (Alex/Riley/Mira
 * all ship one), inside a printed-portrait frame (identity-hue ground + ink-offset
 * halo) with an optional live status pip. An in-frame identity letter is the
 * fallback for any future agent without a sprite bundle.
 * Decorative (aria-hidden): always rendered beside the agent's name in text.
 * Identity-only: never colors an action control.
 */
export function PrintedPortraitAvatar({
  agentKey,
  size = 28,
  hero = false,
  status = "idle",
  halted = false,
  showPip = true,
  allowMotion = true,
  className,
}: PrintedPortraitAvatarProps) {
  const reduced = usePrefersReducedMotion();
  const { bundle, variant } = SPRITES[agentKey];
  const visual = agentVisualState(status, halted);
  const def = bundle && variant ? (bundle[variant] ?? null) : null;
  // Every agent renders a sprite (falling back to idle frames if a requested
  // state is missing). The in-frame identity letter is reached only if `def`
  // is null, i.e. a future agent with no sprite bundle.
  const sprite = def
    ? { frames: def.states[visual.spriteState] ?? def.states.idle, palette: def.palette }
    : null;
  const playing = allowMotion && visual.playing && !reduced;
  const fill = size === "fill";
  // Sprite box: 82% of the frame (the identity ground shows around the inset
  // plate). In fill mode the 82% lives in CSS (.fillInner); in number mode it
  // is the rounded px size.
  const spriteSize = fill ? ("fill" as const) : Math.round(size * 0.82);
  // Fallback letter (unreached today; every agent ships a sprite). In fill mode
  // there is no px box to derive from; 40px reads correctly at hero scale.
  const letterSize = fill ? 40 : Math.round(size * 0.4);
  const spriteNode = sprite && (
    <AnimatedSprite
      frames={sprite.frames}
      palette={sprite.palette}
      size={spriteSize}
      playing={playing}
    />
  );

  return (
    <span
      className={`${styles.portrait} ${AGENT_CLASS[agentKey]}${fill ? ` ${styles.fill}` : ""}${
        hero ? ` ${styles.hero}` : ""
      }${className ? ` ${className}` : ""}`}
      style={fill ? undefined : { width: size, height: size }}
      data-agent={agentKey}
      data-sprite-state={visual.spriteState}
      data-pip={visual.pip}
      data-playing={playing ? "true" : "false"}
      data-size={fill ? "fill" : undefined}
      data-hero={hero ? "true" : undefined}
      aria-hidden="true"
    >
      <span className={styles.plate}>
        {spriteNode ? (
          fill ? (
            <span className={styles.fillInner}>{spriteNode}</span>
          ) : (
            spriteNode
          )
        ) : (
          <span className={styles.letter} style={{ fontSize: letterSize }}>
            {AGENT_LETTER[agentKey]}
          </span>
        )}
      </span>
      {showPip && <span className={styles.pip} data-pip={visual.pip} />}
    </span>
  );
}
