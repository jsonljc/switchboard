import { describe, it, expect } from "vitest";
import { loadSkill } from "../skill-loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../..");

describe("skill-loader minimumModelTier", () => {
  it("loads skill without minimumModelTier as undefined", () => {
    const skill = loadSkill("sales-pipeline", join(REPO_ROOT, "skills"));
    expect(skill.minimumModelTier).toBeUndefined();
  });

  it("loads ad-optimizer with minimumModelTier: premium", () => {
    const skill = loadSkill("ad-optimizer", join(REPO_ROOT, "skills"));
    expect(skill.minimumModelTier).toBe("premium");
  });
});
