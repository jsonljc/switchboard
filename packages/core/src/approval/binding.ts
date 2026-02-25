import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalizeSync } from "../audit/canonical-json.js";

export function computeBindingHash(data: {
  envelopeId: string;
  envelopeVersion: number;
  actionId: string;
  parameters: Record<string, unknown>;
  decisionTraceHash: string;
  contextSnapshotHash: string;
}): string {
  const input = canonicalizeSync({
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
  const serialized = canonicalizeSync(obj);
  return createHash("sha256")
    .update(serialized)
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
  if (storedHash.length !== currentHash.length) return false;
  return timingSafeEqual(Buffer.from(storedHash), Buffer.from(currentHash));
}
