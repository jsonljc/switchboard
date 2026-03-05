import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BusinessProfileSchema, type BusinessProfile } from "@switchboard/schemas";

/**
 * Loads and validates a business profile from a JSON file in the profiles directory.
 *
 * Usage:
 *   const loader = new ProfileLoader("/path/to/profiles");
 *   const profile = await loader.load("clinic-demo");
 *   // profile is a validated BusinessProfile
 */
export class ProfileLoader {
  private readonly profilesDir: string;
  private cache = new Map<string, BusinessProfile>();

  constructor(profilesDir: string) {
    this.profilesDir = resolve(profilesDir);
  }

  /**
   * Load and validate a business profile by ID.
   * Caches the result so subsequent calls with the same ID are instant.
   * Throws if the file is missing or fails validation.
   */
  async load(profileId: string): Promise<BusinessProfile> {
    const cached = this.cache.get(profileId);
    if (cached) return cached;

    const filePath = join(this.profilesDir, `${profileId}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`Business profile not found: ${filePath}`);
      }
      throw new Error(
        `Failed to read business profile ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in business profile: ${filePath}`);
    }

    const result = BusinessProfileSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Business profile validation failed for "${profileId}":\n${issues}`);
    }

    const profile = result.data;

    // Verify the ID in the file matches the requested profile ID
    if (profile.id !== profileId) {
      throw new Error(
        `Business profile ID mismatch: file is named "${profileId}.json" but profile.id is "${profile.id}"`,
      );
    }

    this.cache.set(profileId, profile);
    return profile;
  }

  /**
   * Clear the cache for a specific profile or all profiles.
   */
  clearCache(profileId?: string): void {
    if (profileId) {
      this.cache.delete(profileId);
    } else {
      this.cache.clear();
    }
  }
}
