"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type RoleFocus = "leads" | "bookings" | "care" | "growth" | "default";
export type WorkingStyle = "proactive" | "responsive" | "methodical";
export type Tone = "warm" | "professional" | "concise" | "friendly";
export type Autonomy = "full" | "sometimes" | "always";

interface OperatorCharacterProps {
  roleFocus?: RoleFocus;
  workingStyle?: WorkingStyle;
  tone?: Tone;
  autonomy?: Autonomy;
  className?: string;
}

/* ─── Color system ─── */
const ROLE_COLORS: Record<RoleFocus, { body: string; aura: string; accent: string }> = {
  leads:    { body: "hsl(238 28% 52%)", aura: "hsl(238 28% 68%)", accent: "hsl(238 55% 72%)" },
  bookings: { body: "hsl(186 35% 38%)", aura: "hsl(186 35% 56%)", accent: "hsl(186 50% 62%)" },
  care:     { body: "hsl(28 35% 44%)",  aura: "hsl(28 38% 62%)",  accent: "hsl(30 55% 58%)"  },
  growth:   { body: "hsl(152 28% 36%)", aura: "hsl(152 28% 54%)", accent: "hsl(152 40% 60%)" },
  default:  { body: "hsl(30 8% 44%)",   aura: "hsl(30 8% 60%)",   accent: "hsl(30 50% 50%)"  },
};

/* ─── Tone: CSS filter on the figure ─── */
const TONE_FILTER: Record<Tone, string> = {
  warm:         "saturate(1.15) brightness(1.04)",
  professional: "saturate(0.92) brightness(0.98)",
  concise:      "saturate(0.78) brightness(0.94)",
  friendly:     "saturate(1.25) brightness(1.06)",
};

/* ─── Body posture: transform on the whole figure group ─── */
// Applied relative to transform-origin at (180, 290) — center of mass
const BODY_TRANSFORMS: Record<RoleFocus, string> = {
  default:  "translate(0px, 0px) rotate(0deg) scale(1, 1)",
  leads:    "translate(-3px, -5px) rotate(-1.5deg) scale(1, 1)",
  bookings: "translate(0px, -7px) rotate(0deg) scale(1, 1.02)",
  care:     "translate(0px, 0px) rotate(0deg) scale(1.025, 1)",
  growth:   "translate(0px, -10px) rotate(0deg) scale(1, 1.03)",
};

/* ─── Head transform: autonomy ─── */
const HEAD_TRANSFORMS: Record<Autonomy, string> = {
  full:      "translateY(-5px)",
  sometimes: "translateY(0px)",
  always:    "translateY(4px)",
};

/* ─── Scale for working style — applied to body group ─── */
const STYLE_SCALE: Record<WorkingStyle, string> = {
  proactive:  "scale(1.02)",
  responsive: "scale(1)",
  methodical: "scale(0.97)",
};

export function OperatorCharacter({
  roleFocus = "default",
  workingStyle = "responsive",
  tone = "professional",
  autonomy = "sometimes",
  className,
}: OperatorCharacterProps) {
  const colors = ROLE_COLORS[roleFocus];
  const bodyTransform = BODY_TRANSFORMS[roleFocus];
  const headTransform = HEAD_TRANSFORMS[autonomy];
  const styleScale = STYLE_SCALE[workingStyle];
  const toneFilter = TONE_FILTER[tone];

  // Pulse the aura on any config change
  const [auraKey, setAuraKey] = useState(0);
  const prevConfig = useRef({ roleFocus, workingStyle, tone, autonomy });

  useEffect(() => {
    const prev = prevConfig.current;
    if (
      prev.roleFocus !== roleFocus ||
      prev.workingStyle !== workingStyle ||
      prev.tone !== tone ||
      prev.autonomy !== autonomy
    ) {
      setAuraKey((k) => k + 1);
      prevConfig.current = { roleFocus, workingStyle, tone, autonomy };
    }
  }, [roleFocus, workingStyle, tone, autonomy]);

  // Pause animations when the tab is hidden — stops GPU work on background tabs
  const [animationPaused, setAnimationPaused] = useState(false);
  useEffect(() => {
    const onVisibility = () => setAnimationPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const TRANSITION = "transform 700ms cubic-bezier(0.4, 0, 0.2, 1)";

  const playState = animationPaused ? "paused" : "running";

  return (
    <div className={cn("relative flex items-center justify-center select-none", className)}>
      {/* ── Aura / glow layer ──
          Uses a large multi-stop radial gradient instead of filter:blur.
          blur() forces a GPU compositing layer that runs every animation frame;
          a naturally soft gradient achieves the same look without that cost. */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        aria-hidden="true"
      >
        <div
          key={auraKey}
          className="w-[90%] h-[92%] rounded-full animate-aura-breathe"
          style={{
            background: `radial-gradient(ellipse at 50% 44%, ${colors.aura}26 0%, ${colors.aura}14 30%, ${colors.aura}06 55%, transparent 72%)`,
            willChange: "transform, opacity",
            animationPlayState: playState,
          }}
        />
      </div>

      {/* ── Character SVG ── */}
      <svg
        viewBox="0 0 360 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative w-full h-full animate-character-float"
        aria-hidden="true"
        style={{
          filter: toneFilter,
          transition: "filter 700ms cubic-bezier(0.4,0,0.2,1)",
          willChange: "transform",
          animationPlayState: playState,
        }}
      >
        {/* Shadow body (depth layer) */}
        <g
          style={{
            transform: bodyTransform,
            transformOrigin: "180px 290px",
            transition: TRANSITION,
          }}
        >
          {/* Back shoulder shadow — subtly offset */}
          <ellipse
            cx="183"
            cy="202"
            rx="82"
            ry="30"
            fill={colors.body}
            opacity="0.18"
          />

          {/* Shadow torso */}
          <path
            d="M 143 181
               C 128 191, 115 213, 113 240
               C 111 268, 117 295, 133 318
               C 149 339, 166 350, 183 352
               C 200 350, 217 339, 233 318
               C 249 295, 255 268, 253 240
               C 251 213, 238 191, 223 181
               C 210 187, 197 189, 183 189
               C 169 189, 156 187, 143 181 Z"
            fill={colors.body}
            opacity="0.2"
            transform="translate(4px, 5px)"
          />
        </g>

        {/* Main body group — posture transform */}
        <g
          style={{
            transform: `${bodyTransform} ${styleScale}`,
            transformOrigin: "180px 290px",
            transition: TRANSITION,
          }}
        >
          {/* Head group — autonomy transform */}
          <g
            style={{
              transform: headTransform,
              transformOrigin: "180px 112px",
              transition: TRANSITION,
            }}
          >
            {/* Head — slightly irregular oval for humanity */}
            <ellipse
              cx="180"
              cy="112"
              rx="53"
              ry="57"
              fill={colors.body}
            />

            {/* Very subtle facial plane suggestion — two tiny ovals */}
            <ellipse
              cx="167"
              cy="108"
              rx="7"
              ry="9"
              fill={colors.body}
              opacity="0.35"
              style={{ mixBlendMode: "multiply" }}
            />
            <ellipse
              cx="193"
              cy="108"
              rx="7"
              ry="9"
              fill={colors.body}
              opacity="0.35"
              style={{ mixBlendMode: "multiply" }}
            />
          </g>

          {/* Neck connector */}
          <rect
            x="166"
            y="160"
            width="28"
            height="26"
            rx="7"
            fill={colors.body}
          />

          {/* Shoulders — implied by a horizontal oval */}
          <ellipse
            cx="180"
            cy="198"
            rx="80"
            ry="28"
            fill={colors.body}
          />

          {/* Torso — smooth organic path */}
          {/* Widens at shoulders, narrows at waist, natural hip curve */}
          <path
            d="M 140 180
               C 125 190, 112 213, 110 240
               C 108 267, 114 295, 130 317
               C 146 339, 163 350, 180 352
               C 197 350, 214 339, 230 317
               C 246 295, 252 267, 250 240
               C 248 213, 235 190, 220 180
               C 207 186, 194 188, 180 188
               C 166 188, 153 186, 140 180 Z"
            fill={colors.body}
          />

          {/* Accent mark — floats near lower-right of figure */}
          {/* Changes opacity based on role to subtly indicate focus area */}
          <circle
            cx="238"
            cy="272"
            r="10"
            fill={colors.accent}
            opacity="0.7"
            style={{ transition: "fill 700ms cubic-bezier(0.4,0,0.2,1), opacity 700ms" }}
          />
          <circle
            cx="122"
            cy="294"
            r="6"
            fill={colors.accent}
            opacity="0.35"
            style={{ transition: "fill 700ms cubic-bezier(0.4,0,0.2,1)" }}
          />
        </g>
      </svg>
    </div>
  );
}
