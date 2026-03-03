import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SkinManifestSchema, type SkinManifest } from "@switchboard/schemas";

/**
 * Loads and validates a skin manifest from a JSON file in the skins directory.
 *
 * Usage:
 *   const loader = new SkinLoader("/path/to/skins");
 *   const skin = await loader.load("clinic");
 *   // skin is a validated SkinManifest
 */
export class SkinLoader {
  private readonly skinsDir: string;
  private cache = new Map<string, SkinManifest>();

  constructor(skinsDir: string) {
    this.skinsDir = resolve(skinsDir);
  }

  /**
   * Load and validate a skin manifest by ID.
   * Caches the result so subsequent calls with the same ID are instant.
   * Throws if the file is missing or fails validation.
   */
  async load(skinId: string): Promise<SkinManifest> {
    const cached = this.cache.get(skinId);
    if (cached) return cached;

    const filePath = join(this.skinsDir, `${skinId}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`Skin manifest not found: ${filePath}`);
      }
      throw new Error(
        `Failed to read skin manifest ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in skin manifest: ${filePath}`);
    }

    const result = SkinManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Skin manifest validation failed for "${skinId}":\n${issues}`);
    }

    const manifest = result.data;

    // Verify the ID in the file matches the requested skin ID
    if (manifest.id !== skinId) {
      throw new Error(
        `Skin manifest ID mismatch: file is named "${skinId}.json" but manifest.id is "${manifest.id}"`,
      );
    }

    this.cache.set(skinId, manifest);
    return manifest;
  }

  /**
   * Clear the cache for a specific skin or all skins.
   */
  clearCache(skinId?: string): void {
    if (skinId) {
      this.cache.delete(skinId);
    } else {
      this.cache.clear();
    }
  }
}
