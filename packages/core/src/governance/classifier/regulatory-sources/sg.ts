import type { RegulatoryPublicSourceEntry } from "./types.js";

// Conservative seed. Not exhaustive — Phase 1b-2.5 expansion pending regulatory review.
// All patterns are case-insensitive; substrings match against classified sentences.
export const SG_REGULATORY_SOURCES: ReadonlyArray<RegulatoryPublicSourceEntry> = [
  // ───── approved_device ─────
  {
    id: "sg_hsa_thermage_flx",
    category: "approved_device",
    patterns: ["Thermage FLX", "thermage flx"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices/find-medical-device-information"],
    notes: "HSA-listed RF skin-tightening device.",
  },
  {
    id: "sg_hsa_ultherapy",
    category: "approved_device",
    patterns: ["Ultherapy", "ultherapy"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices"],
  },
  {
    id: "sg_hsa_picosure",
    category: "approved_device",
    patterns: ["PicoSure", "picosure"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices"],
  },
  // ───── approved_clinic_claim ─────
  {
    id: "sg_moh_licensed_clinic_generic",
    category: "approved_clinic_claim",
    patterns: ["MOH-licensed", "MOH licensed", "licensed by MOH"],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.moh.gov.sg/hpp/all-healthcare-professionals/healthcare-services-act"],
    notes:
      "Generic MOH-licence language. Does NOT prove a specific clinic; clinic-name claims must escalate.",
  },
  {
    id: "sg_moh_hsa_act_generic",
    category: "approved_clinic_claim",
    patterns: ["under the Healthcare Services Act", /\bHCSA\b/i],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.moh.gov.sg/hpp/all-healthcare-professionals/healthcare-services-act"],
  },
  {
    id: "sg_moh_aesthetic_practice_guidelines",
    category: "approved_clinic_claim",
    patterns: ["aesthetic practice guidelines", "SMC aesthetic guidelines"],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.healthprofessionals.gov.sg/smc"],
  },
  // ───── doctor_credential_path ─────
  {
    id: "sg_smc_registered_generic",
    category: "doctor_credential_path",
    patterns: ["SMC-registered", "SMC registered", "registered with the SMC"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc/public-register-of-doctors"],
    notes:
      "Generic SMC-registration language. Named-person credential claims (e.g., 'Dr X is SMC-registered') must escalate unless a named curated entry exists.",
  },
  {
    id: "sg_smc_specialist_register",
    category: "doctor_credential_path",
    patterns: ["SMC specialist register", "specialist register"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc/public-register-of-doctors"],
  },
  {
    id: "sg_smc_apc",
    category: "doctor_credential_path",
    patterns: [/\bAPC\b/i, "Annual Practising Certificate"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc"],
  },
  // ───── named_certification ─────
  {
    id: "sg_iso_13485",
    category: "named_certification",
    patterns: ["ISO 13485", "ISO13485"],
    jurisdiction: "SG",
    authority: "ISO",
    sources: ["https://www.iso.org/standard/59752.html"],
  },
  {
    id: "sg_gmp",
    category: "named_certification",
    patterns: [/\bGMP\b/i, "Good Manufacturing Practice"],
    jurisdiction: "SG",
    authority: "ISO/WHO",
    sources: ["https://www.hsa.gov.sg/manufacturing"],
  },
  {
    id: "sg_csi_singapore",
    category: "named_certification",
    patterns: ["CaseTrust", "Singapore Quality Class"],
    jurisdiction: "SG",
    authority: "Enterprise Singapore",
    sources: ["https://www.case.org.sg/"],
  },
];
