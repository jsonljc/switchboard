import { sha256 } from "./canonical-hash.js";

export interface EvidencePointer {
  type: "inline" | "pointer";
  hash: string;
  storageRef: string | null;
}

const INLINE_THRESHOLD = 10 * 1024; // 10KB

export function storeEvidence(
  content: unknown,
  storagePrefix?: string,
): EvidencePointer {
  const serialized = JSON.stringify(content);
  const hash = sha256(serialized);

  if (serialized.length <= INLINE_THRESHOLD) {
    return { type: "inline", hash, storageRef: null };
  }

  // For large evidence, generate a storage ref
  // Actual storage implementation would write to object storage
  const storageRef = storagePrefix
    ? `${storagePrefix}/${hash}`
    : `evidence/${hash}`;

  return { type: "pointer", hash, storageRef };
}

export function verifyEvidence(content: unknown, expectedHash: string): boolean {
  const serialized = JSON.stringify(content);
  const actualHash = sha256(serialized);
  return actualHash === expectedHash;
}
