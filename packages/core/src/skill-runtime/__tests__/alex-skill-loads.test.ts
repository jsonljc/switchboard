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
});
