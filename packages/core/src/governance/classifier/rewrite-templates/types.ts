import type { ClaimType } from "@switchboard/schemas";

export type RewriteableClaimType = Extract<
  ClaimType,
  "efficacy" | "safety-claim" | "superiority" | "urgency"
>;

export interface RewriteTemplateEntry {
  id: string;
  jurisdiction: "SG" | "MY";
  claimType: RewriteableClaimType;
  template: string;
  notes?: string;
}
