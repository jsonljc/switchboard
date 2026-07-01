import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolverDatasetSchema, type ResolverCase } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo-root-relative path to the committed resolver-routing dataset. */
export const DEFAULT_DATASET_PATH = join(
  __dirname,
  "..",
  "..",
  ".agent",
  "evals",
  "resolver-evals.json",
);

/**
 * Load and Zod-validate the resolver-routing dataset (a single JSON array of
 * `{ input, expected_skill }` cases). Throws on unreadable/invalid JSON or a schema
 * violation so a malformed dataset fails loudly rather than silently under-running
 * the drift guard.
 */
export function loadResolverCases(path: string = DEFAULT_DATASET_PATH): ResolverCase[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    throw new Error(`resolver dataset ${path}: invalid JSON - ${(e as Error).message}`);
  }
  const parsed = ResolverDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`resolver dataset ${path}: schema violation - ${parsed.error.message}`);
  }
  return parsed.data;
}
