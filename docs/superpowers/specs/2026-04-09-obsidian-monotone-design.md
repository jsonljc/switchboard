# Obsidian Monotone Minimal Interface — Design Spec

**Date:** 2026-04-09
**Scope:** Obsidian vault at `/Users/jasonli/switchboard`
**Approach:** Minimal theme (kepano) + custom CSS snippet override

---

## Overview

Transform the default Obsidian interface into a pure black-and-white, sans-serif minimal environment. No color anywhere — hierarchy comes from size, weight, spacing, and contrast alone. Works in both light and dark mode.

---

## 1. Implementation Stack

- **Theme:** Minimal (kepano) — installed via Obsidian Community Themes
- **Plugins already installed:** `obsidian-minimal-settings`, `obsidian-style-settings`
- **Custom CSS:** One snippet file at `.obsidian/snippets/monotone.css`
- **No web fonts** — system font stack only, zero latency

---

## 2. Color System

All color stripped to a strict black/white scale. No tints, no accent colors, no tag or callout colors.

### Light mode

| Variable                 | Value     | Use                     |
| ------------------------ | --------- | ----------------------- |
| `--background-primary`   | `#ffffff` | Main note area          |
| `--background-secondary` | `#f5f5f5` | Sidebar, panels         |
| `--text-normal`          | `#000000` | Body text               |
| `--text-muted`           | `#666666` | Secondary labels        |
| `--text-faint`           | `#999999` | Tertiary / placeholders |
| `--interactive-accent`   | `#000000` | Links, active states    |
| `--border`               | `#e0e0e0` | Structural borders      |

### Dark mode

| Variable                 | Value     | Use                     |
| ------------------------ | --------- | ----------------------- |
| `--background-primary`   | `#0a0a0a` | Main note area          |
| `--background-secondary` | `#141414` | Sidebar, panels         |
| `--text-normal`          | `#f0f0f0` | Body text               |
| `--text-muted`           | `#888888` | Secondary labels        |
| `--text-faint`           | `#555555` | Tertiary / placeholders |
| `--interactive-accent`   | `#ffffff` | Links, active states    |
| `--border`               | `#2a2a2a` | Structural borders      |

Applied via Obsidian's `.theme-light` / `.theme-dark` body classes (not `prefers-color-scheme`).

### Color neutralization

- Links: underline only, no blue — color matches `--text-normal`
- Tags: no pill background, no color — rendered as `#tag` in muted text
- Callouts: 1px left border in `--border`, no background color, no icon color
- Highlights: `background: rgba(0,0,0,0.08)` light / `rgba(255,255,255,0.08)` dark
- Folder colors, file icon colors: all removed

---

## 3. Typography

Single typeface throughout. Hierarchy via size, weight, and letter-spacing only.

```
Font stack: -apple-system, "Inter", ui-sans-serif, sans-serif
Code only:  ui-monospace, "JetBrains Mono", "Fira Code", monospace
```

| Element   | Size                  | Weight | Case      | Spacing |
| --------- | --------------------- | ------ | --------- | ------- |
| Body      | 15px                  | 400    | normal    | default |
| H1        | 1.4em                 | 500    | uppercase | 0.10em  |
| H2        | 1.2em                 | 500    | normal    | 0.04em  |
| H3–H6     | progressively smaller | 400    | normal    | default |
| UI chrome | system-ui             | 400    | normal    | default |
| Code      | 13px mono             | 400    | —         | —       |

Line height: `1.65` for body. Max content width: `680px` (centered in editor).

---

## 4. Chrome Simplification

### Removed

- Colored file/folder icons
- Tag background pills and colors
- Folder highlight colors
- Callout icon colors and backgrounds
- Scrollbar (visible only on hover)
- Tab close button (visible only on hover)

### Simplified

- **Sidebar:** No distinct background in light mode (`#ffffff`); subtle `#141414` in dark — one unified surface
- **Active tab:** 1px underline only, no pill or rounded background
- **File tree:** Reduced indent (16px), no chevron icons — replaced with a 1px `--border` indent line
- **Toolbar buttons:** `opacity: 0.4` at rest, `opacity: 1` on hover, `transition: 0.15s`
- **Borders:** Single `1px solid var(--border)` only where structurally necessary (sidebar edge, tab bar bottom)
- **Ribbon:** Icons only, no labels; opacity treatment same as toolbar

### Preserved

- Sidebar toggle (collapse/expand)
- Tab bar — functional, just visually stripped
- Search and quick switcher — full functionality, no visual changes beyond color
- Command palette — unchanged beyond color variables

---

## 5. Files to Create/Modify

| File                              | Action                                             |
| --------------------------------- | -------------------------------------------------- |
| `.obsidian/snippets/monotone.css` | Create — main CSS snippet (~80 lines)              |
| `.obsidian/appearance.json`       | Modify — set `cssTheme: "Minimal"`, enable snippet |

The Minimal theme itself must be installed manually through Obsidian's UI (Settings → Appearance → Themes → Browse → "Minimal" by kepano), as theme files cannot be installed via CLI.

---

## 6. Out of Scope

- Custom fonts loaded from the web
- Plugin UI styling (Excalidraw, Dataview table styling, etc.)
- Mobile / Obsidian Sync behavior
- Per-note or per-folder overrides
