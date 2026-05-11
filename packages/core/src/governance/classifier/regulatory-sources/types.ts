export type RegulatoryPublicSourceCategory =
  | "approved_device" // HSA / MDA device approvals
  | "approved_clinic_claim" // MOH / KKM licensed claim language
  | "doctor_credential_path" // SMC / MMC / APC / LCP lookup pattern
  | "named_certification"; // ISO, GMP, public certifications

export interface RegulatoryPublicSourceEntry {
  id: string;
  category: RegulatoryPublicSourceCategory;
  patterns: ReadonlyArray<string | RegExp>;
  jurisdiction: "SG" | "MY";
  authority: string;
  sources: ReadonlyArray<string>;
  notes?: string;
}
