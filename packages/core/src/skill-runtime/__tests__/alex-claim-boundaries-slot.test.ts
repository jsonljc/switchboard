/**
 * TDD: characterise how an unseeded not-required context slot renders.
 *
 * A `required: false` CLAIM_BOUNDARIES context requirement with no backing
 * KnowledgeEntry rows must NOT leave the literal `{{CLAIM_BOUNDARIES}}`
 * string in Alex's prompt.  It must render as empty so the operator never
 * sees a raw placeholder in production copy.
 */
import { describe, it, expect, vi } from "vitest";
import { ContextResolverImpl } from "../context-resolver.js";
import { interpolate } from "../template-engine.js";

describe("alex CLAIM_BOUNDARIES slot — unseeded not-required", () => {
  it("resolver leaves the variable unset when store returns no rows", async () => {
    const store = {
      findActive: vi.fn().mockResolvedValue([]),
    };
    const resolver = new ContextResolverImpl(store);

    const result = await resolver.resolve("org_test", [
      {
        kind: "policy" as const,
        scope: "claim-boundaries",
        injectAs: "CLAIM_BOUNDARIES",
        required: false,
      },
    ]);

    // The resolver must NOT set a variable for an unresolved not-required slot
    expect("CLAIM_BOUNDARIES" in result.variables).toBe(false);
    // Metadata still records the miss
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]!.entriesFound).toBe(0);
  });

  it("interpolating an unset CLAIM_BOUNDARIES variable renders empty, not a literal placeholder", async () => {
    const store = {
      findActive: vi.fn().mockResolvedValue([]),
    };
    const resolver = new ContextResolverImpl(store);

    const { variables } = await resolver.resolve("org_test", [
      {
        kind: "policy" as const,
        scope: "claim-boundaries",
        injectAs: "CLAIM_BOUNDARIES",
        required: false,
      },
    ]);

    const template = "before {{CLAIM_BOUNDARIES}} after";
    // declarations is empty — CLAIM_BOUNDARIES is a context var, not a skill parameter
    const rendered = interpolate(template, variables, []);

    expect(rendered).not.toContain("{{CLAIM_BOUNDARIES}}");
    expect(rendered).toBe("before  after");
  });

  it("interpolating a seeded CLAIM_BOUNDARIES variable injects the content", async () => {
    const store = {
      findActive: vi.fn().mockResolvedValue([
        {
          kind: "policy" as const,
          scope: "claim-boundaries",
          content: "Do not make medical claims.",
          priority: 0,
          updatedAt: new Date(),
        },
      ]),
    };
    const resolver = new ContextResolverImpl(store);

    const { variables } = await resolver.resolve("org_test", [
      {
        kind: "policy" as const,
        scope: "claim-boundaries",
        injectAs: "CLAIM_BOUNDARIES",
        required: false,
      },
    ]);

    const template = "before {{CLAIM_BOUNDARIES}} after";
    const rendered = interpolate(template, variables, []);

    expect(rendered).not.toContain("{{CLAIM_BOUNDARIES}}");
    expect(rendered).toContain("Do not make medical claims.");
  });
});
