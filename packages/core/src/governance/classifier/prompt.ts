import { createHash } from "node:crypto";
import { CLASSIFIER_SCHEMA_VERSION } from "@switchboard/schemas";

/**
 * Human-readable prompt version. Bump on any change to CLASSIFIER_SYSTEM_PROMPT
 * or the claim-type enum. Stamped into every GovernanceVerdict.details by the
 * ClaimClassifierHook (Task 15) for audit traceability.
 */
export const CLASSIFIER_PROMPT_VERSION = "claim-classifier@1.0.0" as const;

/**
 * System prompt for the Layer 2 classifier (Haiku 4.5 with prompt caching).
 * Enumerates the 9 claim types from ClaimTypeSchema and commits the model to
 * structured JSON output via the classify_claim tool (set up in Task 11).
 */
export const CLASSIFIER_SYSTEM_PROMPT =
  `You are a regulatory claim-type classifier for medical aesthetic and beauty spa marketing copy in Singapore and Malaysia.

Given a single sentence from an AI assistant's outbound message, classify it into exactly one of these claim types:
- efficacy: claims about treatment results, outcomes, or effectiveness
- safety-claim: claims about safety, side effects, recovery, suitability
- superiority: comparative or superlative claims about clinic, doctor, treatment, or device
- urgency: time-bounded scarcity or pressure
- testimonial: claims that reference what other clients have said, felt, or experienced
- medical-advice: recommendations for treatment, diagnosis, or care plans
- diagnosis: statements identifying or naming a medical condition the user has
- credentials: claims about doctor qualifications, device approvals, or clinic licensing
- none: neutral facts (booking logistics, address, hours), questions, or non-claim conversation

Respond with structured JSON only via the classify_claim tool. No commentary.

The schema version is ${CLASSIFIER_SCHEMA_VERSION}. Confidence is a number in [0, 1].`.trim();

/**
 * Stable 16-char SHA256 prefix of (system prompt + claim-type enum).
 *
 * Derivation is pure: any prompt or enum-list change automatically bumps the
 * hash. Stamped into GovernanceVerdict.details alongside CLASSIFIER_PROMPT_VERSION
 * so a regression can be traced to exactly which prompt artifact was running.
 *
 * Authors who edit CLASSIFIER_SYSTEM_PROMPT or the claim-type list MUST also
 * bump CLASSIFIER_PROMPT_VERSION — the hash catches the prompt content drift,
 * the version catches deliberate authoring intent.
 */
const CLAIM_TYPES_FOR_HASH = [
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
] as const;

export const CLASSIFIER_PROMPT_HASH = createHash("sha256")
  .update(CLASSIFIER_SYSTEM_PROMPT)
  .update(JSON.stringify(CLAIM_TYPES_FOR_HASH))
  .digest("hex")
  .slice(0, 16);
