import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest is configured with css: false, so we can't import the CSS module and
// inspect its keys. Instead we parse the file as text and extract every class
// selector. This still catches the typo/missing-selector class of bug that
// motivates the integrity check (per plan revision R5).

const REQUIRED_CLASSES = [
  "reportsPage",
  // topbar
  "topbar",
  "topbarRow",
  "brandCluster",
  "brandMark",
  "brandOrg",
  "brandSep",
  "brandPage",
  "topbarRight",
  "livePip",
  "fixture",
  "topbarUser",
  "me",
  // page head
  "pageHead",
  "lead",
  "eyebrow",
  "pageTitle",
  "accent",
  "pageSub",
  "right",
  "dateFolio",
  "windowSeg",
  "on",
  "recompute",
  "btn",
  "spinner",
  "spinning",
  // banner
  "bannerNoconn",
  "msg",
  "cta",
  // section frame
  "section",
  "sectionHead",
  // pull quote
  "pullquoteWrap",
  "pullquote",
  "em",
  "fadeIn",
  // attribution
  "attrBlock",
  "attrHero",
  "attrNum",
  "attrAside",
  "label",
  "desc",
  "attrSplit",
  "attrCard",
  "alex",
  "who",
  "whoGlyph",
  "whoName",
  "whoRole",
  "val",
  "cap",
  "shareLine",
  "shareBar",
  "sharePct",
  // delta badge
  "deltaBadge",
  "pos",
  "neg",
  "flat",
  "arrow",
  // campaigns
  "tblWrap",
  "tblScroll",
  "tbl",
  "sortable",
  "active",
  "asc",
  "submetric",
  "name",
  "muted",
  "roasCell",
  "v",
  "dead",
  "tblCards",
  "campCard",
  "top",
  "grid",
  // cost vs value
  "costBlock",
  "costThree",
  "costCell",
  "paid",
  "alt",
  "saving",
  "costNarrative",
  "sub",
  // live-mode failure states (#472)
  "bannerStale",
  "unavailable",
  "unavailableMsg",
  "retryAction",
  "skeleton",
  "skelHero",
  "skelLine",
  "skelBlock",
] as const;

describe("reports.module.css class integrity", () => {
  it("defines a selector for every class referenced by planned components", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = resolve(here, "../reports.module.css");
    const css = await readFile(cssPath, "utf-8");

    // Extract every class identifier appearing in a selector (`.className`).
    // Class names: letter, digit, hyphen, underscore. CSS Modules support all of these.
    const found = new Set<string>();
    const re = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      if (m[1]) found.add(m[1]);
    }

    const missing = REQUIRED_CLASSES.filter((k) => !found.has(k));
    if (missing.length > 0) {
      throw new Error(
        `Missing CSS class selectors in reports.module.css: ${missing.join(", ")}. ` +
          "Either the CSS module is incomplete, or camelCase keys drifted from kebab-case selectors.",
      );
    }
    expect(missing).toEqual([]);
  });
});
