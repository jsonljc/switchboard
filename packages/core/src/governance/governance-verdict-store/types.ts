import type { GovernanceVerdict } from "@switchboard/schemas";

export interface GovernanceVerdictDetails {
  matchCategory?: string;
  matchId?: string;
  matchedText?: string;
  /** Input gate only — sentence containing the match. */
  sentence?: string;
  /** Guards persist guard-specific context; keys are not enumerated. */
  [key: string]: unknown;
}

export interface GovernanceVerdictRecord extends GovernanceVerdict {
  id: string;
  deploymentId: string;
  details: GovernanceVerdictDetails | null;
  createdAt: string;
}

export interface SaveGovernanceVerdictInput extends GovernanceVerdict {
  deploymentId: string;
  details?: GovernanceVerdictDetails;
}

export interface GovernanceVerdictStore {
  save(input: SaveGovernanceVerdictInput): Promise<GovernanceVerdictRecord>;
  listByConversation(conversationId: string): Promise<GovernanceVerdictRecord[]>;
  listByDeployment(
    deploymentId: string,
    options?: { since?: string; limit?: number },
  ): Promise<GovernanceVerdictRecord[]>;
  countByDeploymentAndClaim(input: {
    deploymentId: string;
    claimType: string;
    action?: string;
    from: Date;
    to: Date;
  }): Promise<number>;
}
