export const MODULE_IDS = ["lead-to-booking", "creative", "ad-optimizer"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleState =
  | "not_setup"
  | "needs_connection"
  | "partial_setup"
  | "connection_broken"
  | "live";

export interface ModuleStatus {
  id: ModuleId;
  state: ModuleState;
  label: string;
  subtext: string;
  metric?: string;
  cta: { label: string; href: string };
  setupProgress?: { done: number; total: number };
  isPlatformBlocking?: boolean;
  lastUpdated: string;
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  "lead-to-booking": "Convert Leads",
  creative: "Create Ads",
  "ad-optimizer": "Improve Spend",
};

export const STATE_PRIORITY: ModuleState[] = [
  "connection_broken",
  "needs_connection",
  "partial_setup",
  "not_setup",
  "live",
];

export const SLUG_TO_MODULE: Record<string, ModuleId> = {
  "alex-conversion": "lead-to-booking",
  "speed-to-lead": "lead-to-booking",
  "sales-pipeline-bundle": "lead-to-booking",
  "creative-family": "creative",
  "performance-creative-director": "creative",
  "ad-optimizer": "ad-optimizer",
};
