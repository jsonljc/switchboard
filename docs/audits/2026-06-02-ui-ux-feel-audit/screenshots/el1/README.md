# EL1 elevation ladder — before / after screenshots

- `ladder-gallery.png` — the headline before/after. Every elevation surface (card rest, card hover, dropdown/popover, bottom sheet, modal) rendered with today's ad-hoc shadows (left) versus the EL1 warm ladder (right), plus the five-level felt ramp. This is where the change is most visible: overlays move from Tailwind's cool rgb(0 0 0) to one warm base.
- `after-home-desktop.png` / `before-home-desktop.png` and the `*-home-mobile.png` pair — the live Home. Near-identical by design: the card surfaces are preserved (only the shared base is unified), so the trust-critical surface does not shift.
- `after-inbox-desktop.png` / `before-inbox-desktop.png` — the live Inbox (decision cards on `--shadow-card`).

Captured on the EL1 worktree dev server with Chrome at deviceScaleFactor 2. The before frames were taken by reverting the shadow files to origin/main while the dev server hot-reloaded, then restoring.
