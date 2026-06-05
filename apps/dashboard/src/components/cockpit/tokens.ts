// Cockpit token family `T` — now fully themeable: every value resolves through
// a globals.css CSS variable (T2 unification, spec §4.4). Triple-form globals
// tokens (--action, --positive, …) are hsl()-wrapped here; already-wrapped
// editorial tokens (--ink*, --hair*) are referenced bare. Consumed in inline
// styles, e.g. `style={{ color: T.ink }}`.
export const T = {
  bg: "hsl(var(--canvas))",
  paper: "hsl(var(--surface))",
  ink: "var(--ink)",
  ink2: "var(--ink-2)",
  ink3: "var(--ink-3)",
  ink4: "var(--ink-4)",
  ink5: "var(--ink-5)",
  hair: "var(--hair)",
  hairSoft: "var(--hair-soft)",
  amber: "hsl(var(--action))",
  amberDeep: "hsl(var(--action-hover))",
  amberSoft: "hsl(var(--action-subtle))",
  amberPaper: "hsl(var(--action-tint))",
  green: "hsl(var(--positive))",
  red: "hsl(var(--destructive))",
  // Type + foreground honesty (mira reskin): the loaded next/font faces and the
  // AA amber foreground, so inline cockpit styles never name a raw family or #fff.
  mono: "var(--font-mono-editorial)",
  display: "var(--font-display-app)",
  actionFg: "hsl(var(--action-foreground))",
} as const;

export type CockpitToken = keyof typeof T;

// Shared accent shape for per-agent cockpit theming. Each agent exports its own
// `*_ACCENT` constant of this shape (e.g. ALEX_APPROVAL_ACCENT, RILEY_ACCENT).
export interface AccentTokens {
  base: string;
  deep: string;
  soft: string;
  paper: string;
}
