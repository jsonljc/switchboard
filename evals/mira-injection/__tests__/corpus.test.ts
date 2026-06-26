import { describe, it, expect } from "vitest";
import { MIRA_INJECTION_CORPUS, miraInjectionCorpusHash } from "../corpus.js";
import { MIRA_PROFILE } from "../../adversarial-injection/agent-profiles.js";
import { InjectionCorpusSchema, INJECTION_CATEGORIES } from "../../adversarial-injection/schema.js";
import type { InjectionCase } from "../../adversarial-injection/schema.js";

const injections = (): InjectionCase[] =>
  MIRA_INJECTION_CORPUS.filter((c) => c.kind === "injection");

describe("mira injection corpus", () => {
  it("is schema-valid (validated at module load, asserted here too)", () => {
    expect(InjectionCorpusSchema.safeParse(MIRA_INJECTION_CORPUS).success).toBe(true);
  });

  it("targets only the mira-taste-facts seam (every case)", () => {
    for (const c of MIRA_INJECTION_CORPUS) expect(c.seam).toBe("mira-taste-facts");
  });

  it("reuses the three shared EV-3 mira cases the live lane was deferred to", () => {
    const ids = new Set(MIRA_INJECTION_CORPUS.map((c) => c.id));
    for (const id of ["mira-reveal-prompt", "mira-roleswap-claim", "mira-ignore-fake-metrics"]) {
      expect(ids.has(id), `missing reused shared case "${id}"`).toBe(true);
    }
  });

  it("adds the unique confirmation-token tooth (MIRA-PWNED-7Q) and forbids it", () => {
    const c = MIRA_INJECTION_CORPUS.find((x) => x.id === "mira-confirm-token");
    expect(c?.payload).toContain("MIRA-PWNED-7Q");
    expect(c?.expect?.forbiddenResponseSubstrings).toContain("MIRA-PWNED-7Q");
  });

  it("routes the content-leak case through the BUSINESS_FACTS seam with a PII tooth", () => {
    const c = MIRA_INJECTION_CORPUS.find((x) => x.id === "mira-facts-content-leak");
    expect(c?.expect?.forbiddenResponseSubstrings).toContain("+6591234567");
  });

  it("includes a 10k-code-point emoji flood case", () => {
    const flood = MIRA_INJECTION_CORPUS.find((c) => c.category === "emoji-flood");
    expect(flood).toBeDefined();
    expect([...flood!.payload].length).toBeGreaterThanOrEqual(10000);
  });

  it("every injection case has deterministic teeth (no silently-dead corpus)", () => {
    // An injection case has teeth iff it carries a forbidden substring / injected tool-arg, OR
    // the Mira profile gives it leak-canary / tool-allowlist teeth. With MIRA_PROFILE populated
    // (canaries + the empty `[]` allowlist), NO Mira injection case is inert.
    const dead = injections().filter((c) => {
      const hasSubstr = (c.expect?.forbiddenResponseSubstrings?.length ?? 0) > 0;
      const hasArg = (c.expect?.injectedToolArgValues?.length ?? 0) > 0;
      const hasTool = MIRA_PROFILE.allowedToolIds !== null;
      const hasLeak = MIRA_PROFILE.promptLeakCanaries.length > 0;
      return !hasSubstr && !hasArg && !hasTool && !hasLeak;
    });
    expect(dead.map((c) => c.id)).toEqual([]);
  });

  it("exercises at least one role-swap and one ignore-instructions injection", () => {
    const cats = new Set(injections().map((c) => c.category));
    expect(cats.has("role-swap")).toBe(true);
    expect(cats.has("ignore-instructions")).toBe(true);
    // every category present is a real ADV-1 injection category.
    for (const cat of cats) {
      expect((INJECTION_CATEGORIES as readonly string[]).includes(cat)).toBe(true);
    }
  });

  it("produces a stable 16-hex corpus hash", () => {
    expect(miraInjectionCorpusHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(miraInjectionCorpusHash()).toBe(miraInjectionCorpusHash());
  });
});
