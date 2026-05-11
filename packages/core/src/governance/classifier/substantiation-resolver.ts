import { createHash } from "node:crypto";
import type {
  ClaimType,
  SubstantiationResolution,
  SubstantiationSourceType,
} from "@switchboard/schemas";
import type {
  ApprovedComplianceClaimRecord,
  ApprovedComplianceClaimStore,
} from "./approved-compliance-claim-store/index.js";
import type { RegulatoryPublicSourceEntry } from "./regulatory-sources/index.js";
import type { SubstantiationCache } from "./substantiation-cache.js";

const STALENESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

const SOURCE_TIERS_BY_CLAIM_TYPE: Record<ClaimType, ReadonlyArray<SubstantiationSourceType>> = {
  efficacy: ["approved_compliance_claim"],
  "safety-claim": ["approved_compliance_claim", "regulatory_public_source"],
  superiority: ["approved_compliance_claim"],
  urgency: ["approved_compliance_claim"],
  testimonial: [],
  "medical-advice": [],
  diagnosis: [],
  credentials: ["regulatory_public_source"],
  none: [],
};

export interface SubstantiationResolverInput {
  sentence: string;
  claimType: ClaimType;
  jurisdiction: "SG" | "MY";
  deploymentId: string;
}

export interface SubstantiationResolver {
  resolve(input: SubstantiationResolverInput): Promise<SubstantiationResolution>;
}

export interface SubstantiationResolverDeps {
  approvedClaimStore: ApprovedComplianceClaimStore;
  regulatoryLoader: (j: "SG" | "MY") => readonly RegulatoryPublicSourceEntry[];
  cache: SubstantiationCache;
  clock: () => Date;
}

function hashSentence(sentence: string): string {
  return createHash("sha256").update(sentence.toLowerCase()).digest("hex").slice(0, 32);
}

function isStale(claim: ApprovedComplianceClaimRecord, now: Date): boolean {
  if (claim.validUntil && new Date(claim.validUntil).getTime() < now.getTime()) return true;
  if (new Date(claim.reviewedAt).getTime() < now.getTime() - STALENESS_WINDOW_MS) return true;
  return false;
}

function matchClaim(
  sentenceLower: string,
  claims: readonly ApprovedComplianceClaimRecord[],
  now: Date,
): SubstantiationResolution | null {
  for (const claim of claims) {
    if (!sentenceLower.includes(claim.claimText.toLowerCase())) continue;
    if (isStale(claim, now)) {
      return {
        status: "stale",
        sourceType: "approved_compliance_claim",
        sourceId: claim.id,
        matchedText: claim.claimText,
      };
    }
    return {
      status: "matched",
      sourceType: "approved_compliance_claim",
      sourceId: claim.id,
      matchedText: claim.claimText,
    };
  }
  return null;
}

function matchRegulatory(
  sentenceLower: string,
  sentenceOriginal: string,
  entries: readonly RegulatoryPublicSourceEntry[],
): SubstantiationResolution | null {
  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (typeof pattern === "string") {
        if (sentenceLower.includes(pattern.toLowerCase())) {
          return {
            status: "matched",
            sourceType: "regulatory_public_source",
            sourceId: entry.id,
            matchedText: pattern,
          };
        }
      } else {
        const m = sentenceOriginal.match(pattern);
        if (m) {
          return {
            status: "matched",
            sourceType: "regulatory_public_source",
            sourceId: entry.id,
            matchedText: m[0],
          };
        }
      }
    }
  }
  return null;
}

/**
 * Layer 3 substantiation resolver. Per-claim-type tier dispatch:
 *   - efficacy / superiority / urgency → approved_compliance_claim only.
 *   - safety-claim → approved_compliance_claim first, then regulatory_public_source.
 *   - credentials → regulatory_public_source only.
 *   - testimonial / medical-advice / diagnosis → empty tier list → always "missing"
 *     (the hook in Task 15 maps these to escalate).
 *
 * Match-only caching: `matched` resolutions are cached; `stale` and `missing` are
 * not. `approvedClaimStore.list` throws are caught and treated as missing for
 * that tier (defensive — emit-integrity > observability).
 */
export function createSubstantiationResolver(
  deps: SubstantiationResolverDeps,
): SubstantiationResolver {
  return {
    async resolve(input): Promise<SubstantiationResolution> {
      const tiers = SOURCE_TIERS_BY_CLAIM_TYPE[input.claimType];
      if (tiers.length === 0) return { status: "missing" };

      const cacheKey = {
        sentenceHash: hashSentence(input.sentence),
        jurisdiction: input.jurisdiction,
        claimType: input.claimType,
        deploymentId: input.deploymentId,
      };

      const cached = deps.cache.get(cacheKey);
      if (cached !== undefined) return cached;

      const sentenceLower = input.sentence.toLowerCase();
      const now = deps.clock();

      for (const tier of tiers) {
        if (tier === "approved_compliance_claim") {
          let claims: readonly ApprovedComplianceClaimRecord[] = [];
          try {
            claims = await deps.approvedClaimStore.list({
              deploymentId: input.deploymentId,
              jurisdiction: input.jurisdiction,
              claimType: input.claimType,
            });
          } catch (err) {
            console.error("[substantiation-resolver] approvedClaimStore.list threw", err);
            continue;
          }
          const hit = matchClaim(sentenceLower, claims, now);
          if (hit) {
            if (hit.status === "matched") deps.cache.set(cacheKey, hit);
            return hit;
          }
        } else if (tier === "regulatory_public_source") {
          const entries = deps.regulatoryLoader(input.jurisdiction);
          const hit = matchRegulatory(sentenceLower, input.sentence, entries);
          if (hit) {
            deps.cache.set(cacheKey, hit);
            return hit;
          }
        }
      }

      return { status: "missing" };
    },
  };
}
