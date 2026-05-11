import type { ClaimType } from "@switchboard/schemas";

export interface ApprovedComplianceClaimQuery {
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
}

export interface ApprovedComplianceClaimRecord {
  id: string;
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  claimText: string;
  reviewedBy: string;
  reviewedAt: string; // ISO string
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedComplianceClaimStore {
  list(query: ApprovedComplianceClaimQuery): Promise<ApprovedComplianceClaimRecord[]>;
}
