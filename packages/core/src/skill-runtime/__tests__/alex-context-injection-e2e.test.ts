/**
 * Regression: resolved KnowledgeEntry content renders into a template slot
 * through the REAL ContextResolverImpl.
 *
 * This test exercises the resolver→interpolation seam only. It does NOT run
 * through SkillMode.execute (Task 2 covers that seam). It uses:
 *   - the real ContextResolverImpl
 *   - a stub knowledge store returning one objection-handling row
 *   - the real Alex skill.context (loaded from skills/alex/SKILL.md)
 *   - the real interpolate function
 *
 * Proves the inverse of alex-claim-boundaries-slot.test.ts: when a row IS
 * present, the marker renders into {{PLAYBOOK_CONTEXT}} and the placeholder
 * disappears.
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextResolverImpl } from "../context-resolver.js";
import { interpolate } from "../template-engine.js";
import { loadSkill } from "../skill-loader.js";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../../skills");

describe("Alex live context injection (resolver-to-template regression)", () => {
  it("renders resolved objection-handling content into the slot (not an empty placeholder)", async () => {
    const skill = loadSkill("alex", SKILLS_DIR);

    const store = {
      findActive: async (_orgId: string, filters: Array<{ kind: string; scope: string }>) =>
        filters
          .filter((f) => f.scope === "objection-handling")
          .map((f) => ({
            kind: f.kind,
            scope: f.scope,
            content: "MEDSPA-OBJECTION-PLAYBOOK-MARKER",
            priority: 0,
            updatedAt: new Date(),
          })),
    };
    const resolver = new ContextResolverImpl(store);

    // Filter out business-facts: it requires a BusinessFactsStore, not the
    // knowledge-entry store. We test only the knowledge-entry path here.
    const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
    const { variables } = await resolver.resolve("org_demo", knowledgeReqs);

    const rendered = interpolate(
      "Objections:\n{{PLAYBOOK_CONTEXT}}\n--end--",
      { ...variables },
      [],
    );

    expect(rendered).toContain("MEDSPA-OBJECTION-PLAYBOOK-MARKER");
    expect(rendered).not.toContain("{{PLAYBOOK_CONTEXT}}");
  });
});
