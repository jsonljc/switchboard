import type { RegulatoryPublicSourceEntry } from "./types.js";

// Conservative seed. Not exhaustive — Phase 1b-2.5 expansion pending regulatory review.
// All patterns are case-insensitive; substrings match against classified sentences.
export const MY_REGULATORY_SOURCES: ReadonlyArray<RegulatoryPublicSourceEntry> = [
  // ───── approved_device ─────
  {
    id: "my_mda_thermage_flx",
    category: "approved_device",
    patterns: ["Thermage FLX", "thermage flx"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_mda_ultherapy",
    category: "approved_device",
    patterns: ["Ultherapy", "ultherapy"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_mda_picosure",
    category: "approved_device",
    patterns: ["PicoSure", "picosure"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  // ───── approved_clinic_claim ─────
  {
    id: "my_kkm_act_586",
    category: "approved_clinic_claim",
    patterns: ["Act 586", "Private Healthcare Facilities and Services Act"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/index.php/database_stores/store_view/17"],
  },
  {
    id: "my_kkm_licensed_clinic_generic",
    category: "approved_clinic_claim",
    patterns: ["KKM-licensed", "KKM licensed", "licensed by KKM"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/"],
    notes: "Generic KKM-licence language. Named-clinic claims must escalate.",
  },
  {
    id: "my_kkm_mab_aesthetic_guidelines",
    category: "approved_clinic_claim",
    patterns: [/\bMAB\b/i, "Malaysian Aesthetic Board"],
    jurisdiction: "MY",
    authority: "MAB",
    sources: ["https://www.moh.gov.my/"],
  },
  // ───── doctor_credential_path ─────
  {
    id: "my_mmc_registered_generic",
    category: "doctor_credential_path",
    patterns: ["MMC-registered", "MMC registered", "registered with the MMC"],
    jurisdiction: "MY",
    authority: "MMC",
    sources: ["https://mmc.gov.my/registered-medical-practitioners/"],
  },
  {
    id: "my_mmc_apc",
    category: "doctor_credential_path",
    patterns: [/\bAPC\b/i, "Annual Practising Certificate"],
    jurisdiction: "MY",
    authority: "MMC",
    sources: ["https://mmc.gov.my/"],
  },
  {
    id: "my_mmc_lcp",
    category: "doctor_credential_path",
    patterns: [/\bLCP\b/i, "Letter of Credentialing and Privileging"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/"],
  },
  // ───── named_certification ─────
  {
    id: "my_iso_13485",
    category: "named_certification",
    patterns: ["ISO 13485", "ISO13485"],
    jurisdiction: "MY",
    authority: "ISO",
    sources: ["https://www.iso.org/standard/59752.html"],
  },
  {
    id: "my_gmp",
    category: "named_certification",
    patterns: [/\bGMP\b/i, "Good Manufacturing Practice"],
    jurisdiction: "MY",
    authority: "ISO/WHO",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_iso_9001",
    category: "named_certification",
    patterns: ["ISO 9001"],
    jurisdiction: "MY",
    authority: "ISO",
    sources: ["https://www.iso.org/iso-9001-quality-management.html"],
  },
];
