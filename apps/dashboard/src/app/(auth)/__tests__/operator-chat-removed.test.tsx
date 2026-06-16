import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Removal guard for the dead Operator Chat widget (D8-1, tier-4 PR 4.1).
 *
 * The widget posted to `POST /api/operator/command`, a route removed in
 * f5299e53, so every message 404'd and taught the operator the product was
 * broken. Decision #3 of the riley-remediation overview: remove it (a broken
 * affordance on every authed page is anti-trust); conversational Riley is the
 * right replacement and is a separate design item (PR 4.3), not a reason to
 * keep a single-tenant relic alive.
 *
 * This guard pins the removal: a future restore re-reds it. The load-bearing
 * assertion is the source sweep (feedback_build_typechecks_dead_files): a
 * surviving import of a deleted symbol would break `next build`, which
 * type-checks orphaned files.
 */

// vitest runs with cwd = apps/dashboard (the package dir), matching
// token-governance.lib.ts. SRC is the dashboard source root.
const SRC = path.resolve(process.cwd(), "src");

/** Every .ts/.tsx file under SRC (tests included, so a stale reference in any
 *  source OR test file re-reds this guard). Skips build/dependency output. */
function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...allSourceFiles(full));
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("operator-chat widget removal (D8-1)", () => {
  it("the operator-chat component directory is gone", () => {
    expect(existsSync(path.join(SRC, "components/operator-chat"))).toBe(false);
  });

  it("the operator-chat proxy route is gone", () => {
    expect(existsSync(path.join(SRC, "app/api/dashboard/operator-chat"))).toBe(false);
  });

  it("no surviving file references the removed symbols (build would type-check them)", () => {
    const FORBIDDEN =
      /OperatorChatWidget|useOperatorChat|operator-chat|sendOperatorCommand|\/api\/operator\/command/;
    const offenders: string[] = [];
    for (const f of allSourceFiles(SRC)) {
      if (f.includes("operator-chat-removed")) continue; // this guard names them on purpose
      if (FORBIDDEN.test(readFileSync(f, "utf8"))) {
        offenders.push(f.slice(f.indexOf("/src/") + 1));
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the authed layout source no longer mounts the widget", () => {
    const layout = readFileSync(path.join(SRC, "app/(auth)/layout.tsx"), "utf8");
    expect(layout).not.toContain("OperatorChatWidget");
  });
});
