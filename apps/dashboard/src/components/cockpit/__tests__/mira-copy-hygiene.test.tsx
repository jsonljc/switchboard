import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// CI guard: Mira M1 is draft-only. The source files below must NEVER contain
// publish/launch CTA wording. "Draft only — nothing is published" is the
// ALLOWED reassurance copy; the regexes below target the CTA words (Publish as
// a standalone word, Launch, Go live, Approve creative) that must NOT appear.
// ---------------------------------------------------------------------------

// Resolve source paths relative to the `apps/dashboard` package root.
// __dirname = apps/dashboard/src/components/cockpit/__tests__
// Four levels up lands on apps/dashboard.
const DASHBOARD_ROOT = resolve(__dirname, "../../../..");
const SOURCES: Array<{ path: string; allow?: string[] }> = [
  { path: resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/mira-config.ts") },
  {
    path: resolve(DASHBOARD_ROOT, "src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx"),
    // Slice-2 exception: the detail page renders the MEASURED performance
    // block written by the attribution sweep (always as-of dated; spec
    // 2026-06-04-mira-slice2-learning-loop-design.md section 3.9). Real
    // measured data is not a fabricated capability claim; every other
    // forbidden word (and every other surface) stays guarded.
    allow: ["performance"],
  },
  // Live feed surfaces (PR3A/3B) — guard against forbidden CTAs on the active UI
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-feed-page.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-card.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-creative-feed.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-actions.tsx") },
  // Phase 2 Director's Desk surfaces:
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-desk-page.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-in-production-tray.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-needs-attention.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-ready-to-review.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/desk-copy.ts") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-brief-box.tsx") },
  { path: resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-kept-shelf.tsx") },
];

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "Publish (standalone word)", re: /\bPublish\b/i },
  { label: "Launch", re: /\bLaunch\b/i },
  { label: "Go live", re: /\bGo live\b/i },
  { label: "Approve creative", re: /Approve creative/i },
  // Phase-2 banned words (spec §"Phase 2 copy guardrails"). "Riley"/"Keep"/"kept"
  // are ALLOWED ("Sending to Riley comes later"); the capability VERBS are not.
  { label: "distribute", re: /\bdistribut/i },
  { label: "performance", re: /\bperformance\b/i },
  { label: "winner", re: /\bwinner\b/i },
  { label: "fatigued", re: /\bfatigued\b/i },
  { label: "learning", re: /\blearning\b/i },
  { label: "improved", re: /\bimproved\b/i },
  { label: "drove", re: /\bdrove\b/i },
  { label: "recovered", re: /\brecovered\b/i },
  { label: "saved", re: /\bsaved\b/i },
];

describe("Mira M1 copy hygiene — draft-only, no publish/launch CTAs", () => {
  for (const { path: src, allow } of SOURCES) {
    const shortPath = src.replace(DASHBOARD_ROOT, "").replace(/^\//, "");
    it(`${shortPath} contains no forbidden CTAs`, () => {
      const content = readFileSync(src, "utf-8");
      const hits: Array<{ label: string; match: string }> = [];
      for (const { label, re } of FORBIDDEN) {
        if (allow?.includes(label)) continue;
        const m = content.match(re);
        if (m) hits.push({ label, match: m[0] });
      }
      if (hits.length > 0) {
        const formatted = hits.map((h) => `  "${h.label}" matched "${h.match}"`).join("\n");
        throw new Error(
          `${shortPath} contains forbidden publish/launch CTA wording:\n${formatted}\n` +
            `(Allowed: "not published", "nothing is published", "stays a draft" — reassurance copy only.)`,
        );
      }
      expect(hits).toEqual([]);
    });
  }
});
