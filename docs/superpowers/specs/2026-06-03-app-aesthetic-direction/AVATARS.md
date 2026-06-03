# Agent pixel avatars — how to use (DO NOT redraw the pixel art)

These are the REAL Switchboard agent sprites (Alex Classic, Riley Analyst) as 24×24
pixel art, plus a labelled Mira placeholder. They render via a tiny script.

**The pixel ART is fixed.** You design everything AROUND them — the frame/tile, the
background, glow, halo, border, crop, the scale they appear at, and any motion. That
"frame around fixed pixels" is exactly the aesthetic question you're answering.

## 1. Inline this script once (keeps your mockup self-contained)
Copy the entire contents of `avatars.js` (in this same folder) into a
`<script>…</script>` near the end of your `<body>`. It is ~2KB. Or, if your mockup
lives in this same folder, you may instead use `<script src="./avatars.js"></script>`.

## 2. Place an avatar — two ways
**Declarative (easiest):** put a span with `data-sb-avatar` inside any sized box.
The SVG auto-fills its parent, so the wrapper controls the size.
```html
<!-- a 28px Inbox chip -->
<span style="display:inline-block;width:28px;height:28px"><span data-sb-avatar="alex"></span></span>

<!-- a 96px hero tile -->
<div style="width:96px;height:96px"><span data-sb-avatar="riley"></span></div>
```
**Imperative:** `el.innerHTML = sbAvatar("mira")` returns the SVG string.

Names: `"alex"`, `"riley"`, `"mira"`. Keep them crisp — the SVG already sets
`shape-rendering="crispEdges"`; do not blur or anti-alias the pixels.

## Who they are (so your framing fits their character)
- **alex** — brown side-part, headset, navy blazer + red tie. Warm sales/ops colleague. Identity hue = amber/coral.
- **riley** — ponytail, round glasses, lavender blouse + gold pearl. Sharp ad-analyst. Identity hue = lavender/indigo.
- **mira** — PLACEHOLDER (violet recolor of Riley). Mira is the creative/UGC agent. Identity hue = violet.
  Mira's real 8-bit sprite is an OPEN DELIVERABLE — if you want, mock your own idea of
  Mira's distinct pixel character in your direction's style and call it out in your writeup.
