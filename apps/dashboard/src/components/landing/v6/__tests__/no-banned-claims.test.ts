import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const V6_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(__dirname, "../../../..", "app", "(public)");

const sourceFiles = (): string[] => {
  const v6 = readdirSync(V6_DIR)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
    .map((f) => join(V6_DIR, f));
  return [...v6, join(PUBLIC_DIR, "page.tsx"), join(PUBLIC_DIR, "layout.tsx")];
};

interface Banned {
  pattern: RegExp;
  reason: string;
}

const BANNED: Banned[] = [
  {
    pattern: /twelve seconds/,
    reason: "no SLA telemetry — Alex's first-reply timing is unmeasured",
  },
  { pattern: /12-second/, reason: "no SLA telemetry — Alex's first-reply timing is unmeasured" },
  { pattern: /one memory/i, reason: "no shared-memory layer between agents" },
  { pattern: /14-day pilot/, reason: "no pilot SKU exists in billing" },
  { pattern: /Cal\.com/, reason: "Cal.com integration is URL-only, not a real connector" },
  { pattern: /Notion/, reason: "Notion connector does not exist" },
  { pattern: /Exportable/, reason: "no audit export endpoint" },
  { pattern: /Searchable/, reason: "no full-text audit search" },
  { pattern: /Pick any two/, reason: "no bundle discount logic" },
  { pattern: /Hire all three/, reason: "no bundle discount logic" },
  { pattern: /save 15%/, reason: "no bundle discount logic" },
  { pattern: /save 25%/, reason: "no bundle discount logic" },
  { pattern: /0\.15 \/ conversation/, reason: "no overage billing" },
  { pattern: /0\.75% of incremental/, reason: "no overage billing" },
  { pattern: /\$0\.20 \/ chat/, reason: "no overage billing" },
  { pattern: /\$0\.50 \/ credit/, reason: "no Mira credit system" },
  { pattern: /image = 1 credit/, reason: "no Mira credit system" },
  { pattern: /short video = 10/, reason: "no Mira credit system" },
  { pattern: /avatar video = 20/, reason: "no Mira credit system" },
  { pattern: /HD video = 50/, reason: "no Mira credit system" },
  { pattern: /in one toggle/, reason: "no per-action autonomy toggle UI" },
  { pattern: /per agent, per action/, reason: "no per-action autonomy toggle UI" },
  { pattern: /moves money/, reason: "Nova has no approval gate (slice B)" },
  { pattern: /Never auto-publishes the big stuff/, reason: "Nova has no approval gate (slice B)" },
  { pattern: /All systems normal/, reason: "no real status feed wired" },
  {
    pattern: /\$199(?!\d)/,
    reason: "no $199 14-day pilot SKU; new pilot prices are $249/$249/$399",
  },
  {
    pattern: /[Aa]pproval-first/,
    reason: "doctrine softened to 'agents draft, you publish' until slice B ships",
  },
];

describe("v6 landing — no banned marketing claims", () => {
  const files = sourceFiles();

  it("source file inventory is non-empty (smoke test)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const banned of BANNED) {
    it(`pattern ${banned.pattern} is absent (${banned.reason})`, () => {
      const offenders: string[] = [];
      for (const path of files) {
        const content = readFileSync(path, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (banned.pattern.test(line)) {
            offenders.push(`${path}:${idx + 1} → ${line.trim()}`);
          }
        });
      }
      if (offenders.length > 0) {
        const message = `Banned pattern ${banned.pattern} found:\n${offenders.join("\n")}\nReason: ${banned.reason}\nIf this claim is now backed by product code, update this test.`;
        throw new Error(message);
      }
    });
  }
});
