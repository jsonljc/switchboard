import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { composePackBody } from "../pack-composer.js";

// Repo skills root, resolved up from this test dir via import.meta.dirname (same
// technique as evals/skill-prompt-golden/render.ts, from a deeper location).
const SKILLS_DIR = resolve(import.meta.dirname, "../../../../../skills");
const GENERIC_PACK_DIR = resolve(SKILLS_DIR, "alex", "packs", "generic");
const MEDSPA_PACK_DIR = resolve(SKILLS_DIR, "alex", "packs", "medspa");

// A minimal skeleton carrying the SAME @pack marker the alex SKILL.md uses, so a
// deployment that resolves packDir to packs/generic (a future self-serve wiring)
// splices the floor block via the unchanged marker.
const BODY = "intro\n\n<!-- @pack:safety-escalation -->\n\noutro";

describe("safe-harbor floor persona block (SH-5)", () => {
  it("renders the generic floor block through composePackBody (splice-ready, fail-closed passes)", () => {
    const rendered = composePackBody(BODY, GENERIC_PACK_DIR);
    expect(rendered).toContain("Safe-harbor boundaries");
    expect(rendered).toContain("You are an AI assistant");
    expect(rendered).toContain("No financial, legal, or medical advice");
    // The marker is consumed; no literal comment leaks into the prompt.
    expect(rendered).not.toContain("@pack:");
  });

  it("is DISJOINT from the medspa block (same marker, different pack, different content)", () => {
    const generic = composePackBody(BODY, GENERIC_PACK_DIR);
    const medspa = composePackBody(BODY, MEDSPA_PACK_DIR);
    expect(generic).not.toBe(medspa);
    // The floor is vertical-agnostic: no medspa-specific medical-red-flag copy.
    expect(generic).not.toContain("Medical red flags");
    expect(medspa).toContain("Medical red flags");
  });
});
