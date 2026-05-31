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
const SOURCES = [
  resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/mira-config.ts"),
  resolve(DASHBOARD_ROOT, "src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx"),
  // Live feed surfaces (PR3A/3B) — guard against forbidden CTAs on the active UI
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-feed-page.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-card.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-creative-feed.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-actions.tsx"),
  // Phase 2 Director's Desk surfaces:
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-desk-page.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-in-production-tray.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-ready-to-review.tsx"),
  resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/desk-copy.ts"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-brief-box.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-kept-shelf.tsx"),
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
  for (const src of SOURCES) {
    const shortPath = src.replace(DASHBOARD_ROOT, "").replace(/^\//, "");
    it(`${shortPath} contains no forbidden CTAs`, () => {
      const content = readFileSync(src, "utf-8");
      const hits: Array<{ label: string; match: string }> = [];
      for (const { label, re } of FORBIDDEN) {
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
