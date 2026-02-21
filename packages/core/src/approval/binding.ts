import { createHash } from "node:crypto";

export function computeBindingHash(data: {
  envelopeId: string;
  envelopeVersion: number;
  actionId: string;
  parameters: Record<string, unknown>;
  decisionTraceHash: string;
  contextSnapshotHash: string;
}): string {
  const input = JSON.stringify({
    envelopeId: data.envelopeId,
    envelopeVersion: data.envelopeVersion,
    actionId: data.actionId,
    parameters: data.parameters,
    decisionTraceHash: data.decisionTraceHash,
    contextSnapshotHash: data.contextSnapshotHash,
  });

  return createHash("sha256").update(input).digest("hex");
}

export function hashObject(obj: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(obj))
    .digest("hex");
}

export function validateBindingHash(
  storedHash: string,
  currentData: {
    envelopeId: string;
    envelopeVersion: number;
    actionId: string;
    parameters: Record<string, unknown>;
    decisionTraceHash: string;
    contextSnapshotHash: string;
  },
): boolean {
  const currentHash = computeBindingHash(currentData);
  return storedHash === currentHash;
}
