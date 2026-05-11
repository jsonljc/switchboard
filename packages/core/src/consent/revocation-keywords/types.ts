import type { PdpaJurisdiction } from "@switchboard/schemas";

export interface RevocationKeywordEntry {
  /** Stable id, e.g. "stop_baseline", "my_berhenti". */
  id: string;
  patterns: ReadonlyArray<string | RegExp>;
  jurisdiction: PdpaJurisdiction | "both";
  notes?: string;
}
