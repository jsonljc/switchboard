import { describe, it, expect } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import { registerSkillIntents } from "../skill-intent-registrar.js";
import { loadSkill } from "../../skill-runtime/skill-loader.js";

// Managed-inbound smoke (Phase 0 preflight). A full bootstrapSkillMode() boot
// needs ANTHROPIC_API_KEY (skill-mode.ts:128) + a real PrismaClient + ~20 DB
// stores, and CI has no Postgres — so this exercises the SAME seam without a
// boot: the REAL skills/alex/SKILL.md → the REAL registrar → a REAL
// IntentRegistry, then the EXACT lookup + trigger checks PlatformIngress.submit
// runs for the ChannelGateway request (channel-gateway.ts:313 submits
// `${skillSlug}.respond`, trigger "chat"; platform-ingress.ts:163 returns
// intent_not_found when the lookup is undefined). If this red, managed inbound
// is dead at ingress.
const SKILLS_DIR = new URL("../../../../../skills", import.meta.url).pathname;

describe("managed inbound: real alex SKILL.md resolves the gateway's respond intent", () => {
  it("loads alex.run from the real SKILL.md frontmatter", () => {
    const alex = loadSkill("alex", SKILLS_DIR);
    expect(alex.slug).toBe("alex");
    expect(alex.intent).toBe("alex.run");
  });

  it("registers an intent the ChannelGateway's submit can find (no intent_not_found)", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [loadSkill("alex", SKILLS_DIR)]);

    // The gateway builds `intent: `${resolved.skillSlug}.respond`` for the
    // "alex" deployment → "alex.respond".
    const gatewayIntent = "alex.respond";
    expect(registry.lookup(gatewayIntent)).toBeDefined();
    expect(registry.validateTrigger(gatewayIntent, "chat")).toBe(true);
  });
});
