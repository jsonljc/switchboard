# Type voice (Fraunces + no-italics) live verification

Captured 2026-06-04 against the running dev stack (org_dev seed), branch `feat/type-voice-fraunces`.

## before/ and after/

Same matrix both sides: Home, Inbox, Results at 390px and 1280px, plus the Alex agent panel at 1280px.

What changed between the folders:

- Display face: Newsreader (Home register) and Iowan Old Style (the inbox's broken "Newsreader" stack) become Fraunces everywhere the display tokens reach.
- The verdict reads "3 things need you. Start with Alex." (was an em-dash connector), upright, accent in the deep identity ink at weight 700 (was italic in the base hue).
- Zero italics: module headings, week-note (drop cap, signoff, PS), inbox pagehead and empty states, agent-panel headings and empty states, results prose.

## aa-report.txt

Live pixel-sampled contrast on the REAL grounds (label hidden, region clipped, pngjs average, WCAG vs computed color):

- Poster names and role lines: 4.85 to 6.01 against the grain wash, floor 4.5 (all PASS).
- Verdict accent (deep identity ink): 3.96 against the grained canvas. This element is 36 to 48px at weight 700, WCAG large-scale text, AA floor 3:1 (PASS with margin). A token gate in `token-governance.test.ts` holds the three deep inks at 3.5+ against the ungrained canvas to preserve that live margin.

## fout/

`fout-fallback.png` = woff2 requests aborted (the size-adjusted "Fraunces Fallback", Times at size-adjust 115.45% with ascent/descent overrides). `fout-loaded.png` = normal load.

Measured: per-line metrics match (line boxes identical), but the wider fallback wraps the verdict sentence onto two lines, a 49.9px stack shift IF the real font were to arrive after first paint. Context and mitigation:

- next/font preloads the self-hosted woff2 same-origin in production builds, so the swap normally happens at or before first paint (the dev server does not emit the preload, a Turbopack dev artifact).
- If the font never loads, the page stays on the fallback and never shifts; the shift only occurs on a late swap.
- This line-count sensitivity predates this slice (Newsreader rode the same Times-based adjusted fallback); it is recorded here so the follow-up that applies the full type scale can consider a tighter verdict measure if it ever shows up in field CLS data.
