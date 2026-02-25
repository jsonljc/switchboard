import { sha256 } from "./canonical-hash.js";
import { canonicalizeSync } from "./canonical-json.js";

export interface EvidencePointer {
  type: "inline" | "pointer";
  hash: string;
  storageRef: string | null;
}

export interface EvidenceStore {
  store(key: string, data: Buffer): Promise<string>;
  retrieve(key: string): Promise<Buffer>;
}

/**
 * In-memory evidence store for dev/testing.
 */
export class InMemoryEvidenceStore implements EvidenceStore {
  private data = new Map<string, Buffer>();

  async store(key: string, data: Buffer): Promise<string> {
    this.data.set(key, data);
    return key;
  }

  async retrieve(key: string): Promise<Buffer> {
    const data = this.data.get(key);
    if (!data) throw new Error(`Evidence not found: ${key}`);
    return data;
  }
}

/**
 * File system evidence store for development and single-node production.
 */
export class FileSystemEvidenceStore implements EvidenceStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private async assertSafePath(key: string): Promise<string> {
    const path = await import("node:path");
    const resolved = path.resolve(this.basePath, key);
    const normalizedBase = path.resolve(this.basePath) + path.sep;
    if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(this.basePath)) {
      throw new Error(`Path traversal detected: ${key}`);
    }
    return resolved;
  }

  async store(key: string, data: Buffer): Promise<string> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = await this.assertSafePath(key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async retrieve(key: string): Promise<Buffer> {
    const fs = await import("node:fs/promises");
    const filePath = await this.assertSafePath(key);
    return fs.readFile(filePath);
  }
}

const INLINE_THRESHOLD = 10 * 1024; // 10KB

let globalEvidenceStore: EvidenceStore | null = null;

/**
 * Set the global evidence store implementation.
 */
export function setEvidenceStore(store: EvidenceStore): void {
  globalEvidenceStore = store;
}

export function storeEvidence(
  content: unknown,
  storagePrefix?: string,
): EvidencePointer {
  const serialized = canonicalizeSync(content);
  const hash = sha256(serialized);

  if (serialized.length <= INLINE_THRESHOLD) {
    return { type: "inline", hash, storageRef: null };
  }

  // For large evidence, generate a storage ref and store if backend available
  const storageRef = storagePrefix
    ? `${storagePrefix}/${hash}`
    : `evidence/${hash}`;

  if (globalEvidenceStore) {
    // Store asynchronously (fire and forget for now)
    globalEvidenceStore.store(storageRef, Buffer.from(serialized)).catch(() => {
      // Storage failure is non-fatal — the hash is still recorded in the audit trail
    });
  }

  return { type: "pointer", hash, storageRef };
}

export function verifyEvidence(content: unknown, expectedHash: string): boolean {
  const serialized = canonicalizeSync(content);
  const actualHash = sha256(serialized);
  return actualHash === expectedHash;
}
