import { describe, it, expect } from "vitest";
import { loadSkill } from "../skill-loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../..");

describe("alex skill context requirements", () => {
  it("declares CLAIM_BOUNDARIES context requirement with correct shape", () => {
    const skill = loadSkill("alex", join(REPO_ROOT, "skills"));
    const claimBoundaries = skill.context?.find((c) => c.injectAs === "CLAIM_BOUNDARIES");

    expect(claimBoundaries).toBeDefined();
    expect(claimBoundaries).toMatchObject({
      kind: "policy",
      scope: "claim-boundaries",
      injectAs: "CLAIM_BOUNDARIES",
      required: false,
    });
  });

  it("enforces required posture for all five context slots (advisory=false, BUSINESS_FACTS=true)", () => {
    const skill = loadSkill("alex", join(REPO_ROOT, "skills"));
    const req = (injectAs: string) => skill.context?.find((c) => c.injectAs === injectAs);
    expect(req("PLAYBOOK_CONTEXT")?.required).toBe(false);
    expect(req("POLICY_CONTEXT")?.required).toBe(false);
    expect(req("QUALIFICATION_CONTEXT")?.required).toBe(false);
    expect(req("CLAIM_BOUNDARIES")?.required).toBe(false);
    expect(req("BUSINESS_FACTS")?.required).toBe(true);
  });

  it("declares deposit-link in its tool list (registered in skill-mode for confirmed-booking deposits)", () => {
    const skill = loadSkill("alex", join(REPO_ROOT, "skills"));
    expect(skill.tools).toContain("deposit-link");
  });
});
