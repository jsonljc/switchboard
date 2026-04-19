# Obsidian Monotone Minimal Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Obsidian vault UI into a pure black-and-white, sans-serif minimal environment using the Minimal theme + a custom CSS snippet.

**Architecture:** Install the Minimal theme (kepano) as the structural base, then apply a single `.obsidian/snippets/monotone.css` file that overrides all color variables to a strict B&W scale, sets a unified sans-serif font stack, and strips decorative chrome. The `appearance.json` is updated to activate both the theme and the snippet.

**Tech Stack:** Obsidian CSS custom properties (CSS variables), Minimal theme by kepano, Obsidian's `.theme-light` / `.theme-dark` body classes.

---

## Prerequisites

> These manual steps cannot be scripted. Complete them before running any tasks.

1. Open Obsidian → Settings → Appearance → Themes → Browse
2. Search "Minimal" by kepano → Install → Enable
3. Confirm `.obsidian/themes/Minimal.css` now exists in the vault

---

## Task 1: Create the snippets directory and color system

**Files:**

- Create: `.obsidian/snippets/monotone.css`

- [ ] **Step 1: Create the snippets directory**

```bash
mkdir -p /Users/jasonli/switchboard/.obsidian/snippets
```

- [ ] **Step 2: Write the color system — light and dark mode variables**

Create `.obsidian/snippets/monotone.css` with this exact content:

```css
/* ─── MONOTONE MINIMAL — switchboard vault ──────────────────────────── */

/* ── 1. COLOR SYSTEM ─────────────────────────────────────────────────── */

.theme-light {
  --background-primary: #ffffff;
  --background-secondary: #ffffff;
  --background-secondary-alt: #f5f5f5;
  --background-modifier-border: #e0e0e0;
  --background-modifier-hover: rgba(0, 0, 0, 0.04);
  --background-modifier-active-hover: rgba(0, 0, 0, 0.06);
  --text-normal: #000000;
  --text-muted: #666666;
  --text-faint: #999999;
  --text-on-accent: #ffffff;
  --interactive-accent: #000000;
  --interactive-accent-hover: #333333;
  --link-color: #000000;
  --link-color-hover: #000000;
  --link-external-color: #000000;
  --link-external-color-hover: #000000;
  --tag-color: #666666;
  --tag-background: transparent;
  --tag-border-color: #cccccc;
  --divider-color: #e0e0e0;
  --color-accent: #000000;
  --color-accent-1: #333333;
  --color-accent-2: #555555;
}

.theme-dark {
  --background-primary: #0a0a0a;
  --background-secondary: #0a0a0a;
  --background-secondary-alt: #141414;
  --background-modifier-border: #2a2a2a;
  --background-modifier-hover: rgba(255, 255, 255, 0.04);
  --background-modifier-active-hover: rgba(255, 255, 255, 0.06);
  --text-normal: #f0f0f0;
  --text-muted: #888888;
  --text-faint: #555555;
  --text-on-accent: #000000;
  --interactive-accent: #ffffff;
  --interactive-accent-hover: #cccccc;
  --link-color: #f0f0f0;
  --link-color-hover: #ffffff;
  --link-external-color: #f0f0f0;
  --link-external-color-hover: #ffffff;
  --tag-color: #888888;
  --tag-background: transparent;
  --tag-border-color: #333333;
  --divider-color: #2a2a2a;
  --color-accent: #ffffff;
  --color-accent-1: #cccccc;
  --color-accent-2: #aaaaaa;
}
```

- [ ] **Step 3: Verify the file exists**

```bash
ls -la /Users/jasonli/switchboard/.obsidian/snippets/monotone.css
```

Expected: file exists, non-zero size.

- [ ] **Step 4: Commit**

```bash
git add .obsidian/snippets/monotone.css
git commit -m "feat(obsidian): add monotone CSS snippet — color system"
```

---

## Task 2: Add typography

**Files:**

- Modify: `.obsidian/snippets/monotone.css`

- [ ] **Step 1: Append the typography block to monotone.css**

Open `.obsidian/snippets/monotone.css` and append after the color system:

```css
/* ── 2. TYPOGRAPHY ───────────────────────────────────────────────────── */

body {
  --font-text-theme: -apple-system, "Inter", ui-sans-serif, sans-serif;
  --font-interface-theme: -apple-system, "Inter", ui-sans-serif, sans-serif;
  --font-monospace-theme: ui-monospace, "JetBrains Mono", "Fira Code", monospace;
  --font-text-size: 15px;
  --line-height-normal: 1.65;
  --editor-line-height: 1.65;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
}

/* Headings — live editor (CM6) */
.cm-header-1 {
  font-size: 1.4em !important;
  font-weight: 500 !important;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.cm-header-2 {
  font-size: 1.2em !important;
  font-weight: 500 !important;
  letter-spacing: 0.04em;
}
.cm-header-3 {
  font-size: 1.05em !important;
  font-weight: 400 !important;
}
.cm-header-4 {
  font-size: 1em !important;
  font-weight: 400 !important;
}
.cm-header-5 {
  font-size: 0.95em !important;
  font-weight: 400 !important;
}
.cm-header-6 {
  font-size: 0.9em !important;
  font-weight: 400 !important;
}

/* Headings — reading view */
.markdown-reading-view h1 {
  font-size: 1.4em;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.markdown-reading-view h2 {
  font-size: 1.2em;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.markdown-reading-view h3 {
  font-size: 1.05em;
  font-weight: 400;
}
.markdown-reading-view h4 {
  font-size: 1em;
  font-weight: 400;
}
.markdown-reading-view h5 {
  font-size: 0.95em;
  font-weight: 400;
}
.markdown-reading-view h6 {
  font-size: 0.9em;
  font-weight: 400;
}

/* Max content width — centered */
.markdown-source-view.mod-cm6 .cm-contentContainer {
  max-width: 680px;
  margin: 0 auto;
}
.markdown-reading-view .markdown-preview-section {
  max-width: 680px;
  margin: 0 auto;
}
```

- [ ] **Step 2: Commit**

```bash
git add .obsidian/snippets/monotone.css
git commit -m "feat(obsidian): add typography to monotone CSS snippet"
```

---

## Task 3: Add chrome simplification and color neutralization

**Files:**

- Modify: `.obsidian/snippets/monotone.css`

- [ ] **Step 1: Append chrome simplification block**

Open `.obsidian/snippets/monotone.css` and append:

```css
/* ── 3. CHROME SIMPLIFICATION ────────────────────────────────────────── */

/* Active tab — underline only, no pill */
.workspace-tab-header.is-active {
  border-bottom: 1px solid var(--text-normal);
  background: transparent !important;
  box-shadow: none !important;
}
.workspace-tab-header.is-active .workspace-tab-header-inner {
  background: transparent !important;
}

/* Tab close — show only on hover */
.workspace-tab-header .workspace-tab-header-inner-close-button {
  opacity: 0;
  transition: opacity 0.15s;
}
.workspace-tab-header:hover .workspace-tab-header-inner-close-button {
  opacity: 1;
}

/* Scrollbar — hidden until hover */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}
*:hover::-webkit-scrollbar-thumb {
  background: var(--text-faint);
}
::-webkit-scrollbar-track {
  background: transparent;
}

/* Toolbar/view-action buttons — dim at rest */
.view-actions .clickable-icon {
  opacity: 0.4;
  transition: opacity 0.15s;
}
.view-actions .clickable-icon:hover {
  opacity: 1;
}

/* Ribbon — dim at rest */
.workspace-ribbon .side-dock-ribbon-action {
  opacity: 0.4;
  transition: opacity 0.15s;
}
.workspace-ribbon .side-dock-ribbon-action:hover {
  opacity: 1;
}

/* File tree — reduced indent, no chevron */
.nav-folder-collapse-indicator {
  display: none;
}
.tree-item-children {
  padding-left: 16px !important;
  border-left: 1px solid var(--divider-color);
  margin-left: 8px;
}

/* ── 4. COLOR NEUTRALIZATION ─────────────────────────────────────────── */

/* Links — underline only, no color */
a,
.cm-hmd-internal-link,
.internal-link,
.external-link {
  color: var(--link-color) !important;
  text-decoration: underline;
}

/* Tags — no pill, no color */
.tag {
  background: transparent !important;
  color: var(--tag-color) !important;
  border: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

/* Callouts — left border only, no background, no icon color */
.callout {
  background: transparent !important;
  border: none !important;
  border-left: 1px solid var(--divider-color) !important;
  border-radius: 0 !important;
  padding-left: 1em;
}
.callout-icon {
  display: none !important;
}
.callout-title {
  color: var(--text-muted) !important;
  font-weight: 500;
}
.callout-title-inner {
  color: var(--text-muted) !important;
}

/* Highlights — subtle gray, no yellow */
mark {
  background: rgba(0, 0, 0, 0.08) !important;
  color: inherit !important;
}
.theme-dark mark {
  background: rgba(255, 255, 255, 0.08) !important;
}

/* Folder/file color overrides — strip all */
.nav-file-title,
.nav-folder-title {
  color: var(--text-normal) !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add .obsidian/snippets/monotone.css
git commit -m "feat(obsidian): add chrome and color neutralization to monotone snippet"
```

---

## Task 4: Activate the snippet in appearance.json

**Files:**

- Modify: `.obsidian/appearance.json`

- [ ] **Step 1: Update appearance.json**

> Note: After installing the Minimal theme in the prerequisite step, appearance.json will have been updated by Obsidian. Check its current content first:

```bash
cat /Users/jasonli/switchboard/.obsidian/appearance.json
```

Then write the updated file — preserving any fields Obsidian added, and adding `enabledCssSnippets`:

```json
{
  "cssTheme": "Minimal",
  "enabledCssSnippets": ["monotone"]
}
```

> If Obsidian added other fields (e.g. `baseFontSize`, `interfaceFontFamily`), keep them. Only ensure `cssTheme` is `"Minimal"` and `enabledCssSnippets` contains `"monotone"`.

- [ ] **Step 2: Commit**

```bash
git add .obsidian/appearance.json
git commit -m "feat(obsidian): activate Minimal theme and monotone snippet"
```

---

## Task 5: Verify in Obsidian

> This task is manual — open Obsidian and check each item.

- [ ] **Step 1: Reload snippets**

In Obsidian: Settings → Appearance → CSS snippets → toggle "monotone" off, then on (or click the refresh icon). Confirm it shows as enabled.

- [ ] **Step 2: Verify light mode**

Switch to light mode (Settings → Appearance → Base color scheme → Light). Check:

- Background is pure white, no warm/cool tint
- Sidebar background matches main area (no gray distinction)
- Text is pure black
- Links are black with underline, not blue
- Tags appear as plain `#text` in muted gray, no pill
- Active tab has underline only

- [ ] **Step 3: Verify dark mode**

Switch to dark mode. Check:

- Background is near-black `#0a0a0a`
- Text is soft white `#f0f0f0`
- Same structure checks as light mode

- [ ] **Step 4: Verify typography**

Open any note with headings. Check:

- H1 is uppercase with wide letter-spacing
- H2 is medium-weight with slight tracking
- Body text is sans-serif (not serif, not mono)
- Content is centered with ~680px max width

- [ ] **Step 5: Verify chrome**

- Hover a tab — close button appears
- Don't hover any tab — close button hidden
- Scroll a long note — scrollbar appears only on hover
- Toolbar icons are dim at rest, full opacity on hover
- File tree has no chevron arrows, indent lines visible

- [ ] **Step 6: Commit any fixes found during verification**

If any CSS needed adjustment during verification:

```bash
git add .obsidian/snippets/monotone.css
git commit -m "fix(obsidian): adjust monotone snippet after visual verification"
```

---

## Complete File Reference

### `.obsidian/snippets/monotone.css` (complete, ~120 lines)

The assembled file after all tasks, for reference:

```css
/* ─── MONOTONE MINIMAL — switchboard vault ──────────────────────────── */

/* ── 1. COLOR SYSTEM ─────────────────────────────────────────────────── */

.theme-light {
  --background-primary: #ffffff;
  --background-secondary: #ffffff;
  --background-secondary-alt: #f5f5f5;
  --background-modifier-border: #e0e0e0;
  --background-modifier-hover: rgba(0, 0, 0, 0.04);
  --background-modifier-active-hover: rgba(0, 0, 0, 0.06);
  --text-normal: #000000;
  --text-muted: #666666;
  --text-faint: #999999;
  --text-on-accent: #ffffff;
  --interactive-accent: #000000;
  --interactive-accent-hover: #333333;
  --link-color: #000000;
  --link-color-hover: #000000;
  --link-external-color: #000000;
  --link-external-color-hover: #000000;
  --tag-color: #666666;
  --tag-background: transparent;
  --tag-border-color: #cccccc;
  --divider-color: #e0e0e0;
  --color-accent: #000000;
  --color-accent-1: #333333;
  --color-accent-2: #555555;
}

.theme-dark {
  --background-primary: #0a0a0a;
  --background-secondary: #0a0a0a;
  --background-secondary-alt: #141414;
  --background-modifier-border: #2a2a2a;
  --background-modifier-hover: rgba(255, 255, 255, 0.04);
  --background-modifier-active-hover: rgba(255, 255, 255, 0.06);
  --text-normal: #f0f0f0;
  --text-muted: #888888;
  --text-faint: #555555;
  --text-on-accent: #000000;
  --interactive-accent: #ffffff;
  --interactive-accent-hover: #cccccc;
  --link-color: #f0f0f0;
  --link-color-hover: #ffffff;
  --link-external-color: #f0f0f0;
  --link-external-color-hover: #ffffff;
  --tag-color: #888888;
  --tag-background: transparent;
  --tag-border-color: #333333;
  --divider-color: #2a2a2a;
  --color-accent: #ffffff;
  --color-accent-1: #cccccc;
  --color-accent-2: #aaaaaa;
}

/* ── 2. TYPOGRAPHY ───────────────────────────────────────────────────── */

body {
  --font-text-theme: -apple-system, "Inter", ui-sans-serif, sans-serif;
  --font-interface-theme: -apple-system, "Inter", ui-sans-serif, sans-serif;
  --font-monospace-theme: ui-monospace, "JetBrains Mono", "Fira Code", monospace;
  --font-text-size: 15px;
  --line-height-normal: 1.65;
  --editor-line-height: 1.65;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
}

.cm-header-1 {
  font-size: 1.4em !important;
  font-weight: 500 !important;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.cm-header-2 {
  font-size: 1.2em !important;
  font-weight: 500 !important;
  letter-spacing: 0.04em;
}
.cm-header-3 {
  font-size: 1.05em !important;
  font-weight: 400 !important;
}
.cm-header-4 {
  font-size: 1em !important;
  font-weight: 400 !important;
}
.cm-header-5 {
  font-size: 0.95em !important;
  font-weight: 400 !important;
}
.cm-header-6 {
  font-size: 0.9em !important;
  font-weight: 400 !important;
}

.markdown-reading-view h1 {
  font-size: 1.4em;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.markdown-reading-view h2 {
  font-size: 1.2em;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.markdown-reading-view h3 {
  font-size: 1.05em;
  font-weight: 400;
}
.markdown-reading-view h4 {
  font-size: 1em;
  font-weight: 400;
}
.markdown-reading-view h5 {
  font-size: 0.95em;
  font-weight: 400;
}
.markdown-reading-view h6 {
  font-size: 0.9em;
  font-weight: 400;
}

.markdown-source-view.mod-cm6 .cm-contentContainer {
  max-width: 680px;
  margin: 0 auto;
}
.markdown-reading-view .markdown-preview-section {
  max-width: 680px;
  margin: 0 auto;
}

/* ── 3. CHROME SIMPLIFICATION ────────────────────────────────────────── */

.workspace-tab-header.is-active {
  border-bottom: 1px solid var(--text-normal);
  background: transparent !important;
  box-shadow: none !important;
}
.workspace-tab-header.is-active .workspace-tab-header-inner {
  background: transparent !important;
}

.workspace-tab-header .workspace-tab-header-inner-close-button {
  opacity: 0;
  transition: opacity 0.15s;
}
.workspace-tab-header:hover .workspace-tab-header-inner-close-button {
  opacity: 1;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}
*:hover::-webkit-scrollbar-thumb {
  background: var(--text-faint);
}
::-webkit-scrollbar-track {
  background: transparent;
}

.view-actions .clickable-icon {
  opacity: 0.4;
  transition: opacity 0.15s;
}
.view-actions .clickable-icon:hover {
  opacity: 1;
}

.workspace-ribbon .side-dock-ribbon-action {
  opacity: 0.4;
  transition: opacity 0.15s;
}
.workspace-ribbon .side-dock-ribbon-action:hover {
  opacity: 1;
}

.nav-folder-collapse-indicator {
  display: none;
}
.tree-item-children {
  padding-left: 16px !important;
  border-left: 1px solid var(--divider-color);
  margin-left: 8px;
}

/* ── 4. COLOR NEUTRALIZATION ─────────────────────────────────────────── */

a,
.cm-hmd-internal-link,
.internal-link,
.external-link {
  color: var(--link-color) !important;
  text-decoration: underline;
}

.tag {
  background: transparent !important;
  color: var(--tag-color) !important;
  border: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

.callout {
  background: transparent !important;
  border: none !important;
  border-left: 1px solid var(--divider-color) !important;
  border-radius: 0 !important;
  padding-left: 1em;
}
.callout-icon {
  display: none !important;
}
.callout-title {
  color: var(--text-muted) !important;
  font-weight: 500;
}
.callout-title-inner {
  color: var(--text-muted) !important;
}

mark {
  background: rgba(0, 0, 0, 0.08) !important;
  color: inherit !important;
}
.theme-dark mark {
  background: rgba(255, 255, 255, 0.08) !important;
}

.nav-file-title,
.nav-folder-title {
  color: var(--text-normal) !important;
}
```
