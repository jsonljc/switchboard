/**
 * Shared sort logic for Campaigns widgets.
 * Both /reports (Campaigns) and /results (CampaignsSection) import from here.
 * Markup stays separate per surface.
 */

import type { CampaignRow } from "@switchboard/schemas";

export type CampaignSortKey = keyof CampaignRow;
export type SortDir = "asc" | "desc";

/** Sort a CampaignRow array by the given key and direction. Nulls sort last. */
export function sortCampaigns(
  campaigns: CampaignRow[],
  key: CampaignSortKey,
  dir: SortDir,
): CampaignRow[] {
  return [...campaigns].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    // Nulls sort last regardless of direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = av as number;
    const bn = bv as number;
    return dir === "asc" ? an - bn : bn - an;
  });
}

/** Toggle sort direction: same key = flip dir; new key = desc for numbers, asc for strings. */
export function nextSortDir(
  currentKey: CampaignSortKey,
  newKey: CampaignSortKey,
  currentDir: SortDir,
  isNumeric: boolean,
): SortDir {
  if (currentKey === newKey) {
    return currentDir === "asc" ? "desc" : "asc";
  }
  return isNumeric ? "desc" : "asc";
}
