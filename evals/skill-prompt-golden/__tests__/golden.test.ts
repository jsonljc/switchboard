/**
 * Golden prompt-diff gate. Byte-snapshots the fully-assembled medspa system
 * prompt (skeleton + spliced pack blocks + injected slots + governance tail).
 * ZERO diff for medspa is the merge gate for every vertical-pack slice: a
 * behavior-preserving refactor keeps every snapshot green; any drift reddens it.
 *
 * Model-free and DB-free: no ANTHROPIC_API_KEY, no Postgres. Runs in the free CI
 * path via evals/vitest.config.ts. Update deliberately with `vitest -u`.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { renderMedspaPrompt } from "../render.js";
import { GOLDEN_FIXTURES } from "../fixtures.js";

describe("medspa golden system prompt (byte-diff gate)", () => {
  for (const fixture of GOLDEN_FIXTURES) {
    it(`renders byte-identical: ${fixture.id}`, async () => {
      const prompt = await renderMedspaPrompt(fixture);
      await expect(prompt).toMatchFileSnapshot(
        resolve(import.meta.dirname, `../snapshots/${fixture.id}.prompt.txt`),
      );
    });
  }

  it("carries the medspa safety envelope and the governance tail", async () => {
    const prompt = await renderMedspaPrompt(GOLDEN_FIXTURES[0]!);
    // The safety-escalation block must be present in the assembled prompt (post
    // split it is spliced from the medspa pack; pre split it is inline).
    expect(prompt).toContain("## Medical red flags");
    expect(prompt).toContain("HIFU");
    // The runtime governance tail (getGovernanceConstraints) must terminate it.
    expect(prompt).toContain("MANDATORY RULES");
  });
});
