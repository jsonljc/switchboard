import type { RiskContract } from "./types";

export interface RiskChip {
  key: string;
  label: string;
  strong?: boolean;
  soft?: boolean;
}

export function riskChips(contract?: RiskContract): RiskChip[] {
  if (!contract)
    return [{ key: "missing", label: "Needs review before this can run", strong: true }];
  const out: RiskChip[] = [];
  if (contract.financialEffect) out.push({ key: "fin", label: "Affects your ad spend or credits" });
  if (contract.externalEffect)
    out.push({ key: "ext", label: "Changes something outside Switchboard" });
  if (contract.clientFacing) out.push({ key: "cli", label: "Goes out to a client" });
  if (contract.requiresConfirmation) out.push({ key: "conf", label: "Needs your explicit okay" });
  if (out.length === 0)
    out.push({ key: "safe", label: "No side effects outside Switchboard", soft: true });
  return out;
}

export function confidenceChip(confidence?: number): RiskChip | null {
  if (confidence === undefined || !Number.isFinite(confidence)) return null;
  const label =
    confidence >= 0.8
      ? "High confidence"
      : confidence >= 0.5
        ? "Medium confidence"
        : "Low confidence";
  return { key: "confidence", label, soft: true };
}
