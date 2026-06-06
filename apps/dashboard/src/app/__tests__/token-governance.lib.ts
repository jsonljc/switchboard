import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Shared helpers for the token-governance guard suite (token-governance.test.ts
 * and type-body-governance.test.ts). Extracted when the guard file hit the
 * eslint max-lines cap (TY4): one walker, one exemption list, no drift between
 * the suites. NOT a test file (vitest collects *.test.* only).
 */

// vitest runs with cwd = apps/dashboard (the package dir).
export const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

export function collectGovernedFiles(): Array<{ path: string; content: string }> {
  const roots = ["src/app", "src/components", "src/lib", "src/styles"];
  const out: Array<{ path: string; content: string }> = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
        walk(full);
      } else if (/\.(css|ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
        if (/-variants\.ts$/.test(e.name)) continue; // sprite pixel data (excluded)
        // Strip the bare `.dark { … }` block — dark palette VALUES are Wave-3
        // deferred (spec §0), not part of the light-mode governance contract.
        const content = readFileSync(full, "utf8").replace(/\.dark\s*\{[^}]*\}/g, "");
        out.push({ path: full, content });
      }
    }
  };
  for (const r of roots) walk(path.resolve(process.cwd(), r));
  return out;
}

/** Path relative to src/ for readable failure messages. */
export const rel = (p: string): string =>
  p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p;

/** First (:root / light) definition of a CSS custom property in globals.css. */
export function tokenValue(name: string): string {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is not defined in globals.css`);
  return m[1].trim();
}

/** Registers with their own type voice (never governed by app type guards). */
export const TYPE_VOICE_EXEMPT = ["(mercury)/", "components/landing/"];
export const typeVoiceGoverned = (p: string): boolean =>
  !TYPE_VOICE_EXEMPT.some((ex) => p.includes(ex));
