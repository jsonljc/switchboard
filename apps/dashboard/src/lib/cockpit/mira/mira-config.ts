// Mira cockpit config — mirrors riley/riley-config.ts. M1 Mira is a draft-only
// creative cockpit: NO composer (no new submission from the Mira UI), so there
// is intentionally no composer placeholder here. A footer note explains where
// drafts originate instead.

// Mira identity accent. Adopts the canonical per-agent token --agent-mira
// (270 45% 58%) — violet is IDENTITY ONLY (avatar, tints, identity edges),
// never on action buttons (the cockpit uses the single amber T.amber for
// committing actions). Mirrors RILEY_ACCENT's shape; unlike Riley's still-
// hardcoded hex this consumes the live token, matching the shipped Mira
// agent-panel. (The old "hsl(265 30% 35%)" note was wrong — no such token.)
export const MIRA_ACCENT = {
  base: "hsl(var(--agent-mira))",
  deep: "hsl(var(--agent-mira-deep))",
  soft: "hsl(var(--agent-mira) / 0.30)",
  paper: "hsl(var(--agent-mira-tint))",
} as const;

export const MIRA_MISSION_SUBTITLE = "Creative drafts — for your review";

export const MIRA_EMPTY_TITLE = "No drafts yet";
export const MIRA_EMPTY_BODY =
  "When creative drafts come in, they'll appear here for your review. Draft only — nothing is published without you.";

// M1 has NO composer on /mira (no new submission from the Mira UI). This footer
// explains where drafts originate instead of showing an inert input.
export const MIRA_FOOTER_NOTE =
  "New briefs come from the existing creative pipeline. Mira's review starts once a draft exists.";
