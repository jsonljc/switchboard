import type { RewriteTemplateEntry } from "./types.js";
import { SG_REWRITE_TEMPLATES } from "./sg.js";
import { MY_REWRITE_TEMPLATES } from "./my.js";

function normalize(entries: readonly RewriteTemplateEntry[]): readonly RewriteTemplateEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate rewrite-template id: ${entry.id}`);
    ids.add(entry.id);
  }
  return Object.freeze([...entries]);
}

const CACHE: Partial<Record<"SG" | "MY", readonly RewriteTemplateEntry[]>> = {};

export function loadRewriteTemplates(jurisdiction: "SG" | "MY"): readonly RewriteTemplateEntry[] {
  const cached = CACHE[jurisdiction];
  if (cached) return cached;
  const raw = jurisdiction === "SG" ? SG_REWRITE_TEMPLATES : MY_REWRITE_TEMPLATES;
  const normalized = normalize(raw);
  CACHE[jurisdiction] = normalized;
  return normalized;
}

export function _resetRewriteTemplateCache(): void {
  delete CACHE["SG"];
  delete CACHE["MY"];
}
