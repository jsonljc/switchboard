import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI guard: ensure no `useQuery({ queryKey: ["billing", ...] })` literal-array
 * keys exist for tenant-private namespaces.
 *
 * Every tenant-private React Query key MUST flow through `useScopedQueryKeys()`
 * (see DC-11 in 01-dashboard-core-findings.md). PR #345 introduced the scoped
 * key factory but missed 5 inline `useQuery` call sites; this test runs at CI
 * time and fails listing every offending file:line so future regressions can't
 * silently re-leak the cache.
 *
 * Allowed first elements:
 *   - Any `__disabled_<name>__` placeholder (used as the disabled-query
 *     sentinel paired with `enabled: !!keys`).
 *   - Anything that is NOT a known tenant-private namespace string.
 *
 * The set below is the literal first segment for each tenant-private namespace
 * defined in `apps/dashboard/src/lib/query-keys.ts`. If the factory grows new
 * tenant-private namespaces, add them here.
 */
const TENANT_PRIVATE_NAMESPACES = new Set([
  "billing",
  "roi",
  "dlq",
  "audit",
  "approvals",
  "escalations",
  "conversations",
  "agents",
  "orgConfig",
  "identity",
  "competence",
  "channels",
  "connections",
  "marketplace",
  "governance",
  "knowledge",
  "playbook",
  "operatorConfig",
  "inbox",
  "tokenUsage",
  "creative",
  "creativeJobs",
  "deployment-for-module",
  "deployment",
  "deployments",
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (st.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

interface Offense {
  file: string;
  line: number;
  match: string;
  firstElement: string;
}

function scan(): Offense[] {
  const offenses: Offense[] = [];
  const files = walk(SRC_ROOT);
  // Match `queryKey: ["something"` or `queryKey: [\n  "something"`.
  // Captures the first quoted string element after `queryKey: [`.
  const re = /queryKey\s*:\s*\[\s*"([^"]+)"/g;

  for (const file of files) {
    // Skip the test file itself so the literal namespace strings inside the
    // allow-list don't get flagged as offenses.
    if (file.endsWith("no-bare-query-keys.test.ts")) continue;
    // Skip co-located test files that intentionally pass bare keys for fixture
    // data (e.g. `queryKey: ["billing", "status"]` in a vi.mock module that
    // never gets matched against the real cache).
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;

    const text = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const firstElement = m[1]!;
      if (firstElement.startsWith("__disabled_")) continue;
      if (!TENANT_PRIVATE_NAMESPACES.has(firstElement)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      offenses.push({
        file: relative(SRC_ROOT, file),
        line,
        match: m[0],
        firstElement,
      });
    }
  }
  return offenses;
}

describe("no bare tenant-private queryKeys", () => {
  it("every queryKey for a tenant-private namespace flows through useScopedQueryKeys", () => {
    const offenses = scan();
    if (offenses.length > 0) {
      const formatted = offenses
        .map((o) => `  ${o.file}:${o.line}  →  ${o.match} (namespace: "${o.firstElement}")`)
        .join("\n");
      throw new Error(
        `Found ${offenses.length} bare tenant-private queryKey(s). ` +
          `Each must use \`useScopedQueryKeys()\` and a \`__disabled_<name>__\` ` +
          `placeholder when keys is null. Offenders:\n${formatted}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
