// Mira cockpit config — mirrors riley/riley-config.ts. M1 Mira is a draft-only
// creative cockpit: NO composer (no new submission from the Mira UI), so there
// is intentionally no composer placeholder here. A footer note explains where
// drafts originate instead.

// Ink-violet identity accent. Matches AGENT_REGISTRY mira accent hsl(265 30% 35%).
export const MIRA_ACCENT = {
  base: "#5B4B8A" /* ink violet */,
  deep: "#3C315C",
  soft: "#D8D2E8",
  paper: "#EFECF6",
} as const;

export const MIRA_MISSION_SUBTITLE = "Creative drafts — for your review";

export const MIRA_EMPTY_TITLE = "No drafts yet";
export const MIRA_EMPTY_BODY =
  "When creative drafts come in, they'll appear here for your review. Draft only — nothing is published without you.";

// M1 has NO composer on /mira (no new submission from the Mira UI). This footer
// explains where drafts originate instead of showing an inert input.
export const MIRA_FOOTER_NOTE =
  "New briefs come from the existing creative pipeline. Mira's review starts once a draft exists.";
