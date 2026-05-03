import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Load root .env so integration tests can reach the dev Postgres database.
// Only sets variables that are not already present in the environment.
const _dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(_dirname, "../../.env");

try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // No .env file — assume vars are set externally (CI).
}
