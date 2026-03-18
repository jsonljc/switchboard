// ---------------------------------------------------------------------------
// Nurture Agent — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

/**
 * Status of a contact's active cadence.
 */
export interface CadenceStatus {
  active: boolean;
  cadenceId: string;
  currentStep: number;
  totalSteps: number;
}

/**
 * Analysis of contact engagement activity.
 */
export interface ActivityAnalysis {
  dormantContacts: string[];
  overdueFollowUps: string[];
  unengagedLeads: string[];
}

/**
 * Dependencies injected into the Nurture Agent handler.
 * The app layer wires these from cartridge implementations.
 */
export interface NurtureAgentDeps {
  /** Check whether a contact already has an active cadence. */
  getCadenceStatus?: (contactId: string) => CadenceStatus | null;

  /** Analyze contact activity for engagement signals. */
  analyzeActivity?: (contactId: string) => ActivityAnalysis;

  /** Score a contact's lifetime value. */
  scoreLtv?: (contactId: string) => { score: number; tier: string };
}
