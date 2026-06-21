/**
 * /results mercury re-voice guard (Task B).
 *
 * These assertions go RED before the CSS token swaps and the .mercuryVoice
 * application, providing the TDD RED proof required by the task spec.
 *
 * After the changes they must all be GREEN.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const resultsCss = readFileSync(
  path.resolve(process.cwd(), "src/components/results/results.module.css"),
  "utf8",
);

const resultsTsx = readFileSync(
  path.resolve(process.cwd(), "src/components/results/results-page.tsx"),
  "utf8",
);

/** Extract the first CSS block for a class selector. */
function classBlock(css: string, className: string): string {
  const re = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`.${className} rule not found in CSS`);
  return m[1];
}

// ─── 1. .mercuryVoice applied to results-page root ───────────────────────────

describe("/results page root — .mercuryVoice class applied", () => {
  it("results-page.tsx imports mercury-voice.module.css", () => {
    expect(resultsTsx).toMatch(/mercury-voice\.module\.css/);
  });

  it("results-page.tsx applies mercuryVoice class to the column div", () => {
    // Both styles.column AND the mercuryVoice class must appear together.
    expect(resultsTsx).toMatch(/mercuryVoice/);
  });

  it("the column div carries both column and mercuryVoice class names", () => {
    // The className prop on the column div should reference both.
    // Check that both styles.column and mercuryVoice appear in the same className expression.
    expect(resultsTsx).toMatch(
      /styles\.column[\s\S]{0,60}mercury|mercury[\s\S]{0,60}styles\.column/,
    );
  });
});

// ─── 2. Background: var(--paper) on the page ground ─────────────────────────

describe("/results page ground — background: var(--paper)", () => {
  it(".column carries background: var(--paper)", () => {
    const block = classBlock(resultsCss, "column");
    expect(block).toMatch(/background:\s*var\(--paper\)/);
  });
});

// ─── 3. VerdictLine serif swap ────────────────────────────────────────────────

describe("VerdictLine — var(--font-home-serif) -> var(--serif)", () => {
  it(".verdictLine uses var(--serif) NOT var(--font-home-serif)", () => {
    const block = classBlock(resultsCss, "verdictLine");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });
});

// ─── 4. WhatsWorking serif swaps ─────────────────────────────────────────────

describe("WhatsWorking prose — var(--font-home-serif) -> var(--serif)", () => {
  it(".whatsWorkingNarrative uses var(--serif)", () => {
    const block = classBlock(resultsCss, "whatsWorkingNarrative");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });

  it(".whatsWorkingCampaign uses var(--serif)", () => {
    const block = classBlock(resultsCss, "whatsWorkingCampaign");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });
});

// ─── 5. WorthIt serif swap + savings cell background ─────────────────────────

describe("WorthIt — narrative serif + savings cell bg", () => {
  it(".worthItNarrative uses var(--serif)", () => {
    const block = classBlock(resultsCss, "worthItNarrative");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });

  it(".worthItCellSaving carries background: var(--paper-warm)", () => {
    // The savings cell gets a dedicated class for the warm background.
    const block = classBlock(resultsCss, "worthItCellSaving");
    expect(block).toMatch(/background:\s*var\(--paper-warm\)/);
  });
});

// ─── 6. AgentContribution card background swap ────────────────────────────────

describe("AgentContribution — agentCard bg: --canvas-2 -> --paper-raised", () => {
  it(".agentCard uses background: var(--paper-raised)", () => {
    const block = classBlock(resultsCss, "agentCard");
    expect(block).toMatch(/background:\s*var\(--paper-raised\)/);
    expect(block).not.toMatch(/var\(--canvas-2\)/);
  });

  it(".agentValueMuted uses var(--serif)", () => {
    const block = classBlock(resultsCss, "agentValueMuted");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });
});

// ─── 7. Results-header / window controls ──────────────────────────────────────

describe("Results-header window controls — --canvas-2 -> --paper-raised", () => {
  it(".windowControl background uses var(--paper-raised)", () => {
    const block = classBlock(resultsCss, "windowControl");
    expect(block).toMatch(/background:\s*var\(--paper-raised/);
    expect(block).not.toMatch(/var\(--canvas-2\)/);
  });

  it(".windowBtnActive standalone block uses var(--paper-raised) as active background", () => {
    // The combined .windowBtn,.windowBtnActive block sets base styles (background: transparent).
    // The standalone .windowBtnActive block is the override; it's the LAST .windowBtnActive rule.
    // Collect all .windowBtnActive blocks and check the last one carries --paper-raised.
    const all: RegExpMatchArray[] = [...resultsCss.matchAll(/\.windowBtnActive\s*\{([^}]*)\}/g)];
    expect(all.length, ".windowBtnActive rule must exist").toBeGreaterThan(0);
    const lastBlock = all[all.length - 1][1];
    expect(lastBlock).toMatch(/background:\s*var\(--paper-raised\)/);
    // Old token was hsl(var(--surface)); must be gone.
    expect(resultsCss).not.toMatch(/hsl\(var\(--surface\)\)/);
  });
});

// ─── 8. No residual var(--font-home-serif) in the SHELL/NARRATIVE/HERO/HEADER classes ──

describe("/results governed re-voiced classes — no residual --font-home-serif", () => {
  // The governed classes that were re-voiced. Task C classes (proofQuality, stateFirstRun,
  // mcEmpty, etc.) are NOT in scope for this task and are excluded from this check.
  const revoicedClasses = [
    "verdictLine",
    "whatsWorkingNarrative",
    "whatsWorkingCampaign",
    "worthItNarrative",
    "agentValueMuted",
  ];

  for (const cls of revoicedClasses) {
    it(`.${cls} carries no legacy --font-home-serif`, () => {
      const block = classBlock(resultsCss, cls);
      expect(block).not.toMatch(/var\(--font-home-serif\)/);
    });
  }
});

// ─── Task C: detail/data surface token swaps ─────────────────────────────────

const worthItTsx = readFileSync(
  path.resolve(process.cwd(), "src/components/results/worth-it.tsx"),
  "utf8",
);

describe("WorthIt savings cell — worthItCellSaving wired (Task C)", () => {
  it("worth-it.tsx applies worthItCellSaving to the savings/You-saved cell", () => {
    // The savings cell must carry both worthItCell and worthItCellSaving class names.
    expect(worthItTsx).toMatch(/worthItCellSaving/);
  });

  it("worthItCellSaving is applied alongside worthItCell on the same element", () => {
    // Both class names should appear near each other (within 120 chars) OR in a compound expression.
    expect(worthItTsx).toMatch(
      /worthItCell[\s\S]{0,120}worthItCellSaving|worthItCellSaving[\s\S]{0,120}worthItCell/,
    );
  });
});

describe("Detail surfaces — serif swaps (Task C)", () => {
  it(".proofQualityEmpty uses var(--serif) not --font-home-serif", () => {
    const block = classBlock(resultsCss, "proofQualityEmpty");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });

  it(".stateFirstRunTitle uses var(--serif) not --font-home-serif", () => {
    const block = classBlock(resultsCss, "stateFirstRunTitle");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });

  it(".mcEmpty uses var(--serif) not --font-home-serif", () => {
    const block = classBlock(resultsCss, "mcEmpty");
    expect(block).toMatch(/font-family:\s*var\(--serif\)/);
    expect(block).not.toMatch(/var\(--font-home-serif\)/);
  });
});

describe("Detail surfaces — canvas->paper border/bg swaps (Task C)", () => {
  it(".disclosureRule border uses --hair not --canvas-3", () => {
    const block = classBlock(resultsCss, "disclosureRule");
    expect(block).toMatch(/--hair\b/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });

  it(".stateBanner border uses --hair-soft not --canvas-3", () => {
    const block = classBlock(resultsCss, "stateBanner");
    expect(block).toMatch(/--hair-soft\b/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });

  it(".campaignCard background uses --paper-raised not --canvas-2", () => {
    const block = classBlock(resultsCss, "campaignCard");
    expect(block).toMatch(/background:\s*var\(--paper-raised\)/);
    expect(block).not.toMatch(/var\(--canvas-2\)/);
  });

  it(".reconcileSelect uses --paper-raised bg and --hair border", () => {
    const block = classBlock(resultsCss, "reconcileSelect");
    expect(block).toMatch(/background:\s*var\(--paper-raised\)/);
    expect(block).toMatch(/--hair\b/);
    expect(block).not.toMatch(/var\(--canvas-2\)/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });

  it(".reconcileInput uses --paper-raised bg and --hair border", () => {
    const block = classBlock(resultsCss, "reconcileInput");
    expect(block).toMatch(/background:\s*var\(--paper-raised\)/);
    expect(block).toMatch(/--hair\b/);
    expect(block).not.toMatch(/var\(--canvas-2\)/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });

  it(".skeletonBlock uses --paper-deep not --canvas-3", () => {
    const block = classBlock(resultsCss, "skeletonBlock");
    expect(block).toMatch(/background:\s*var\(--paper-deep\)/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });

  it(".skeletonCard uses --paper-deep not --canvas-3", () => {
    const block = classBlock(resultsCss, "skeletonCard");
    expect(block).toMatch(/background:\s*var\(--paper-deep\)/);
    expect(block).not.toMatch(/var\(--canvas-3\)/);
  });
});
