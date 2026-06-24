# D3-1 Booked-Value Activation (catalog alignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make Alex emit a `service` string the booked-value resolver matches, by injecting the org playbook's canonical service NAMES into Alex's prompt and instructing exact emission for the booking tool call. Abstain stays the safe default; no fabricated price.

**Architecture:** Builder-owned context injection (mirrors `BUSINESS_FACTS`). A new pure `renderBookableServices` renders the playbook's `PlaybookService.name`s (the SAME store `resolveBookedValueCents` keys on, read via the existing core `PlaybookReader` port). `alexBuilder` sets `BOOKABLE_SERVICES`; `skills/alex/SKILL.md` references `{{BOOKABLE_SERVICES}}` and tells Alex to set the booking-tool `service` to the exact matching name. Resolver is UNCHANGED. Wired in `skill-mode.ts` by passing the already-constructed `PrismaPlaybookReader` into Alex's stores. Worktree: `.claude/worktrees/d3-1-booked-value` (branch `feat/alex-bookable-services-catalog`).

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Zod schemas, Vitest, pnpm + Turborepo. Layers: schemas -> sdk -> core -> db -> apps (no cycles).

**Invariants preserved:** resolver never fabricates (exact id/name match, abstain null); `service` stays human-readable (names not ids); BUSINESS_FACTS remains the customer-facing catalog (no second price source); empty playbook -> empty block -> free-text fallback -> resolver abstains. F12 booking locks/IDOR untouched.

---

### Task 1: `renderBookableServices` pure renderer + renderer<->resolver alignment seam

**Files:**

- Modify: `packages/core/src/skill-runtime/context-resolver.ts` (add export near `renderBusinessFacts`)
- Test: `packages/core/src/skill-runtime/context-resolver.test.ts` (CREATE)

- [ ] **Step 1.1: Write the failing test** (`context-resolver.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import type { PlaybookService } from "@switchboard/schemas";
import { renderBookableServices } from "./context-resolver.js";
import { resolveBookedValueCents } from "./tools/booking-value.js";

function svc(o: Partial<PlaybookService> & { id: string; name: string }): PlaybookService {
  return {
    id: o.id,
    name: o.name,
    price: o.price,
    duration: o.duration,
    bookingBehavior: o.bookingBehavior ?? "ask_first",
    status: o.status ?? "ready",
    source: o.source ?? "manual",
  };
}

describe("renderBookableServices", () => {
  const services = [
    svc({ id: "botox", name: "Botox", price: 300, status: "ready" }),
    svc({ id: "filler", name: "Dermal Filler", price: 600, status: "check_this" }),
    svc({ id: "consult", name: "Consultation", status: "ready" }), // unpriced
    svc({ id: "draft", name: "Unconfirmed Draft", price: 100, status: "missing" }),
    svc({ id: "blank", name: "   ", price: 50, status: "ready" }), // blank name
  ];

  it("renders one bullet per confirmed, named service (trimmed names)", () => {
    const out = renderBookableServices(services);
    expect(out).toContain("- Botox");
    expect(out).toContain("- Dermal Filler");
    expect(out).toContain("- Consultation");
  });

  it("excludes status:missing entries and blank/whitespace names", () => {
    const out = renderBookableServices(services);
    expect(out).not.toContain("Unconfirmed Draft");
    expect(out.split("\n")).not.toContain("- ");
    // exactly the three confirmed, named services
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
  });

  it("dedupes by case-insensitive trimmed name, keeping first", () => {
    const dup = [
      svc({ id: "a", name: "Botox", price: 300 }),
      svc({ id: "b", name: " botox ", price: 999 }),
    ];
    expect(renderBookableServices(dup)).toBe("- Botox");
  });

  it("returns empty string for an empty list or all-excluded list", () => {
    expect(renderBookableServices([])).toBe("");
    expect(renderBookableServices([svc({ id: "m", name: "X", status: "missing" })])).toBe("");
  });

  it("ALIGNMENT SEAM: every rendered name, fed back to the resolver, matches", () => {
    const out = renderBookableServices(services);
    const renderedNames = out.split("\n").map((l) => l.replace(/^- /, ""));
    // Botox -> 30000, Dermal Filler -> 60000, Consultation -> null (unpriced, still a MATCH)
    expect(resolveBookedValueCents({ service: "Botox", services })).toBe(30000);
    expect(resolveBookedValueCents({ service: "Dermal Filler", services })).toBe(60000);
    expect(resolveBookedValueCents({ service: "Consultation", services })).toBeNull();
    // structural guarantee: no rendered name is a non-match (null only when unpriced, never "absent")
    for (const name of renderedNames) {
      const match = services.find(
        (s) => s.id === name || s.name.trim().toLowerCase() === name.toLowerCase(),
      );
      expect(match, `rendered name "${name}" must exist in the resolver's services`).toBeDefined();
    }
  });
});
```

- [ ] **Step 1.2: Run to verify it fails**

Run: `cd .claude/worktrees/d3-1-booked-value && pnpm --filter @switchboard/core test -- context-resolver`
Expected: FAIL — `renderBookableServices` is not exported.

- [ ] **Step 1.3: Implement `renderBookableServices`** (append to `context-resolver.ts`; add `PlaybookService` to the `@switchboard/schemas` type import on line 1)

```ts
/**
 * Render the org playbook's bookable service NAMES as the canonical vocabulary Alex
 * must use for the calendar-book `service` argument. This reads the SAME store the
 * booked-value resolver keys on (resolveBookedValueCents), so any name shown here
 * matches that resolver by name (it normalizes case + trim). Names ONLY: `service`
 * is customer-facing (confirmation text, calendar event), and prices stay sourced
 * from BUSINESS_FACTS to avoid a second, divergent price source.
 *
 * Excludes status:"missing" entries (incomplete/unconfirmed during onboarding) and
 * blank names; dedupes by case-insensitive trimmed name. Returns "" when nothing
 * renders, mirroring the empty BUSINESS_FACTS contract so the prompt slot degrades
 * to a blank line and Alex falls back to free text (the resolver then abstains).
 */
export function renderBookableServices(services: readonly PlaybookService[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of services) {
    if (s.status === "missing") continue;
    const name = s.name.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${name}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 1.4: Run to verify it passes**

Run: `pnpm --filter @switchboard/core test -- context-resolver`
Expected: PASS (5 tests).

- [ ] **Step 1.5: Commit** — `feat(core): render the playbook bookable-service catalog for alex`

---

### Task 2: Add the optional `playbookReader` port to `SkillStores`

**Files:**

- Modify: `packages/core/src/skill-runtime/parameter-builder.ts`

- [ ] **Step 2.1: Add the field + import** (no new test — exercised by Task 3's builder tests, which is the real consumer; this is a pure type addition)

Add import near the other type imports at the top:

```ts
import type { PlaybookReader } from "../conversation-lifecycle/qualification/types.js";
```

Add to the `SkillStores` interface (after `businessFactsStore?`):

```ts
  /**
   * D3-1: OPTIONAL org playbook reader. When provided, alexBuilder renders the
   * playbook's bookable service NAMES into BOOKABLE_SERVICES so Alex emits a
   * `service` the booked-value resolver matches. Optional for back-compat: absent
   * -> BOOKABLE_SERVICES renders "" and Alex falls back to free text (resolver
   * abstains, the safe default).
   */
  playbookReader?: PlaybookReader;
```

- [ ] **Step 2.2: typecheck** — `pnpm --filter @switchboard/core typecheck` (or build). Expected: PASS.
- [ ] **Step 2.3: Commit** — `feat(core): add optional playbook reader to SkillStores`

---

### Task 3: `alexBuilder` emits `BOOKABLE_SERVICES`

**Files:**

- Modify: `packages/core/src/skill-runtime/builders/alex.ts`
- Test: `packages/core/src/skill-runtime/builders/alex.test.ts` (extend)

- [ ] **Step 3.1: Write failing tests** (append a `describe("BOOKABLE_SERVICES (D3-1)")` block to `alex.test.ts`)

```ts
import { renderBookableServices } from "../context-resolver.js"; // add to imports

describe("BOOKABLE_SERVICES (D3-1)", () => {
  const READY_PLAYBOOK = {
    businessIdentity: {
      name: "",
      category: "",
      tagline: "",
      location: "",
      status: "ready",
      source: "manual",
    },
    services: [
      {
        id: "botox",
        name: "Botox",
        price: 300,
        bookingBehavior: "ask_first",
        status: "ready",
        source: "manual",
      },
      {
        id: "draft",
        name: "Unconfirmed",
        price: 50,
        bookingBehavior: "ask_first",
        status: "missing",
        source: "scan",
      },
    ],
    hours: {
      timezone: "",
      schedule: {},
      afterHoursBehavior: "",
      status: "ready",
      source: "manual",
    },
    bookingRules: { leadVsBooking: "", status: "ready", source: "manual" },
    approvalMode: { status: "ready", source: "manual" },
    escalation: { triggers: [], toneBoundaries: "", status: "ready", source: "manual" },
    channels: { configured: [], status: "ready", source: "manual" },
  };

  it("renders BOOKABLE_SERVICES from a wired playbookReader (excludes missing)", async () => {
    const stores = createMockStores({
      playbookReader: { readForOrganization: vi.fn().mockResolvedValue(READY_PLAYBOOK) },
    } as never);
    const result = await alexBuilder(createMockCtx(), config, stores);
    expect(result.parameters.BOOKABLE_SERVICES).toBe("- Botox");
  });

  it("BOOKABLE_SERVICES is '' when no playbookReader is wired", async () => {
    const result = await alexBuilder(createMockCtx(), config, createMockStores());
    expect(result.parameters.BOOKABLE_SERVICES).toBe("");
  });

  it("BOOKABLE_SERVICES is '' when the playbook read returns null", async () => {
    const stores = createMockStores({
      playbookReader: { readForOrganization: vi.fn().mockResolvedValue(null) },
    } as never);
    const result = await alexBuilder(createMockCtx(), config, stores);
    expect(result.parameters.BOOKABLE_SERVICES).toBe("");
  });

  it("fail-open: a playbook read THROW never fails the turn; BOOKABLE_SERVICES is ''", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stores = createMockStores({
      playbookReader: { readForOrganization: vi.fn().mockRejectedValue(new Error("db down")) },
    } as never);
    const result = await alexBuilder(createMockCtx(), config, stores);
    expect(result.parameters.BOOKABLE_SERVICES).toBe("");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 3.2: Run to verify it fails** — `pnpm --filter @switchboard/core test -- alex.test`. Expected: FAIL (`BOOKABLE_SERVICES` undefined).

- [ ] **Step 3.3: Implement** in `alex.ts`. Add the import, the resolution block (after the BUSINESS_FACTS block, before `parameters`), and the parameter.

Import (add near line 5):

```ts
import { renderBusinessFacts, renderBookableServices } from "../context-resolver.js";
```

Resolution block (insert after the BUSINESS_FACTS `if` block, ~line 113):

```ts
// D3-1: render the playbook's bookable service names (the SAME store the
// booked-value resolver keys on) so Alex emits a `service` it matches. Fail-open:
// a playbook read must NEVER 500 a live turn — degrade to "" (free-text fallback,
// resolver abstains).
let BOOKABLE_SERVICES = "";
if (stores.playbookReader) {
  try {
    const playbook = await stores.playbookReader.readForOrganization(orgId);
    if (playbook) BOOKABLE_SERVICES = renderBookableServices(playbook.services);
  } catch (err) {
    console.warn(
      "[alexBuilder] playbook read for bookable services failed; degrading to empty",
      err,
    );
  }
}
```

Add to the `parameters` object (after `BUSINESS_FACTS,`):

```ts
    BOOKABLE_SERVICES,
```

- [ ] **Step 3.4: Run to verify it passes** — `pnpm --filter @switchboard/core test -- alex.test`. Expected: PASS.
- [ ] **Step 3.5: Commit** — `feat(core): alexBuilder injects the bookable-services catalog`

---

### Task 4: `skills/alex/SKILL.md` — `{{BOOKABLE_SERVICES}}` block + exact-emission instruction

**Files:**

- Modify: `skills/alex/SKILL.md` (Phase 4 Book; lines ~202-231)
- Test: a loader assertion (see Step 4.4)

- [ ] **Step 4.1: Insert the Bookable Services block** at the start of `### Phase 4: Book`, right after the `Today is {{CURRENT_DATETIME}}...` line and before numbered step 1. NO em-dashes (user preference).

```markdown
**Bookable services.** When you call the booking tools, set `service` to the exact name of one of these services. This is the name the system uses to confirm and price the booking, so copy it verbatim. Pick the one that best matches what the lead wants. If nothing here fits, or no services are listed, pass a short plain description instead; the booking still goes through.

{{BOOKABLE_SERVICES}}
```

- [ ] **Step 4.2: Update the two emission lines** so slots.query and booking.create use the same canonical name:
  - Line ~212 `   - service: the service they discussed` becomes
    `   - service: the exact bookable-service name above matching what they want (or a short description if none fits)`
  - Line ~228 `   - service: the discussed service` becomes
    `   - service: the same bookable-service name you used for slots.query`

- [ ] **Step 4.3: Confirm no merge-stop / loader trap.** The token `{{BOOKABLE_SERVICES}}` is UPPER_SNAKE (not a dotted-triple tool reference, so it cannot trip `validateToolReferences`). Frontmatter slug is UNCHANGED.

- [ ] **Step 4.4: Loader test** — confirm the alex skill still loads and the template carries the token. Grep for an existing loader test (`loadSkill("alex")`); extend it, or add a focused test asserting `loadSkill("alex", skillsDir).systemPromptTemplate` (or equivalent field) includes `{{BOOKABLE_SERVICES}}` and that loading does not throw. Run it. Expected: PASS. (Pin down the exact field/loader at execution by reading the loader.)

- [ ] **Step 4.5: Commit** — `feat(skills): instruct alex to book using the canonical service name`

---

### Task 5: Wire `playbookReader` into Alex's stores in `skill-mode.ts`

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts` (the SkillMode `stores` object, ~line 862)

- [ ] **Step 5.1: Add the field.** `playbookReader` (a `PrismaPlaybookReader`) is already constructed at line ~169 and used for `getServicesForOrg` at ~420. Add it to the `stores` object next to `businessFactsStore`:

```ts
        businessFactsStore,
        // D3-1: alexBuilder renders BOOKABLE_SERVICES from the SAME playbook the
        // booked-value resolver keys on (getServicesForOrg above), so Alex emits a
        // matchable `service`. PrismaPlaybookReader satisfies the core PlaybookReader port.
        playbookReader,
```

- [ ] **Step 5.2: typecheck the app** — `pnpm --filter @switchboard/api typecheck`. Expected: PASS (PrismaPlaybookReader implements PlaybookReader; the SkillStores field is optional).
- [ ] **Step 5.3:** If a bootstrap/skill-mode test asserts the stores set, extend it to include `playbookReader`. Otherwise the end-to-end proof is the eval-harness deterministic test (Task 7). Run `pnpm --filter @switchboard/api test`. Expected: PASS.
- [ ] **Step 5.4: Commit** — `feat(api): wire the playbook reader into alex's skill stores`

---

### Task 6: calendar-book seam test — rendered name -> resolver -> stamped value

**Files:**

- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (extend the `booking.create booked-value (D3-1)` describe, ~line 606)

- [ ] **Step 6.1: Write the failing test** — derive the booking `service` FROM the renderer's output (not a literal), proving the rendered menu is usable verbatim as the booking service and prices correctly through the REAL booking.create path. Add `import { renderBookableServices } from "../context-resolver.js";` at the top of the file.

```ts
it("SEAM: a service NAME taken verbatim from renderBookableServices stamps the playbook value", async () => {
  // Producer (renderer) with consumer (calendar-book + resolver) from real defaults:
  // the exact string Alex is shown is the exact string that prices the booking.
  const rendered = renderBookableServices(PRICED_SERVICES); // "- Botox"
  const serviceFromMenu = rendered.split("\n")[0]!.replace(/^- /, ""); // "Botox"
  const { t, outboxCreate, updateManySpy } = buildToolWithValueCapture({
    getServicesForOrg: async () => PRICED_SERVICES,
    existingOpp: { id: "opp_1", estimatedValue: 45000 },
  });
  const result = await t.operations["booking.create"]!.execute({
    ...input,
    service: serviceFromMenu,
  });
  expect(result.status).toBe("success");
  const ob = outboxCreate.mock.calls[0]![0] as { data: { payload: { value: number } } };
  expect(ob.data.payload.value).toBe(30000);
  expect(updateManySpy).toHaveBeenCalledWith({
    where: { id: "opp_1", organizationId: "org_trusted", stage: STAGE_GUARD },
    data: { stage: "booked", estimatedValue: 30000 },
  });
});
```

- [ ] **Step 6.2: Run** — `pnpm --filter @switchboard/core test -- calendar-book`. Expected: PASS immediately (renderer + resolver already implemented in Tasks 1/pre-existing). This test LOCKS the alignment at the tool-execution seam; if the renderer ever drifts (e.g. adds a price suffix) this reds. (The existing `Dermaplaning -> abstains` test at ~line 698 already covers the not-in-menu contrast.)
- [ ] **Step 6.3: Commit** — `test(core): lock the bookable-name -> booked-value seam`

---

### Task 7: Eval harness wires a stub playbook; deterministic CI proof BOOKABLE_SERVICES renders

**Files:**

- Modify: `evals/alex-conversation/schema.ts` (add `playbook` fixture field)
- Modify: `evals/alex-conversation/run-conversation.ts` (`resolveParameters`: createStubPlaybook + reader + wire into builderStores)
- Test: `evals/alex-conversation/__tests__/bookable-services.test.ts` (CREATE; deterministic, no API key)

- [ ] **Step 7.1: Add the fixture field** to `ConversationFixtureSchema` (back-compat default keeps every existing fixture unchanged):

```ts
    /**
     * D3-1: which onboarding-playbook state to drive Alex's BOOKABLE_SERVICES with.
     * "absent" (default) = no playbook -> BOOKABLE_SERVICES renders "" (free-text
     * fallback). "operator" = a priced canonical medspa playbook is wired so Alex
     * can book using the exact service name. See run-conversation.ts resolveParameters.
     */
    playbook: z.enum(["operator", "absent"]).default("absent"),
```

- [ ] **Step 7.2: Add a stub playbook + reader and wire it** in `run-conversation.ts` `resolveParameters` (mirror the `createBusinessFactsStore` pattern at ~line 159-160 + builderStores at ~164-189):

```ts
function createStubPlaybook() {
  const base = { status: "ready" as const, source: "manual" as const };
  return {
    businessIdentity: {
      name: "Acme Medspa",
      category: "medspa",
      tagline: "",
      location: "",
      ...base,
    },
    services: [
      { id: "botox", name: "Botox", price: 300, bookingBehavior: "ask_first" as const, ...base },
      {
        id: "filler",
        name: "Dermal Filler",
        price: 600,
        bookingBehavior: "ask_first" as const,
        ...base,
      },
      {
        id: "hydrafacial",
        name: "HydraFacial",
        price: 250,
        bookingBehavior: "book_directly" as const,
        ...base,
      },
    ],
    hours: { timezone: "Asia/Singapore", schedule: {}, afterHoursBehavior: "", ...base },
    bookingRules: { leadVsBooking: "", ...base },
    approvalMode: { ...base },
    escalation: { triggers: [], toneBoundaries: "", ...base },
    channels: { configured: [], ...base },
  };
}
```

In `resolveParameters`, after the businessFactsStore lines:

```ts
const playbook = fixture.playbook === "operator" ? createStubPlaybook() : null;
const playbookReader = { readForOrganization: async (_orgId: string) => playbook };
```

Add `playbookReader,` to the `builderStores` object.

- [ ] **Step 7.3: Write the deterministic test** (`bookable-services.test.ts`) — runs in CI, no ANTHROPIC_API_KEY:

```ts
import { describe, it, expect } from "vitest";
import { resolveParameters } from "../run-conversation.js";
import { loadSkill } from "@switchboard/core"; // or the harness's skill loader; pin at execution
import { ConversationFixtureSchema } from "../schema.js";

const skill = loadSkill("alex"); // resolve the exact loader/signature at execution

function fixture(playbook: "operator" | "absent") {
  return ConversationFixtureSchema.parse({
    id: `bs-${playbook}`,
    vertical: "medspa",
    locale: "sg",
    scenario: "bookable services",
    playbook,
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: {} },
    ],
  });
}

describe("eval harness wires BOOKABLE_SERVICES from the playbook", () => {
  it("playbook:operator -> Alex's prompt carries the canonical service names", async () => {
    const params = await resolveParameters(skill, fixture("operator"));
    expect(params.BOOKABLE_SERVICES).toContain("- Botox");
    expect(params.BOOKABLE_SERVICES).toContain("- HydraFacial");
  });
  it("playbook:absent -> BOOKABLE_SERVICES is '' (free-text fallback)", async () => {
    const params = await resolveParameters(skill, fixture("absent"));
    expect(params.BOOKABLE_SERVICES).toBe("");
  });
});
```

- [ ] **Step 7.4: Run** — `pnpm --filter @switchboard/eval-alex-conversation test -- bookable-services` (resolve the exact eval test command at execution from `evals/.../package.json` + `evals/vitest.config.ts`). Expected: PASS. Also run the eval structural suite (`schema.test.ts`, `load-fixtures.test.ts`, `matrix.test.ts`) to confirm the schema field did not break them.
- [ ] **Step 7.5: Commit** — `test(eval): wire a stub playbook so alex evals exercise BOOKABLE_SERVICES`

---

### Task 8: Eval booking fixture — canonical-name emission (soft, judge-graded)

**Files:**

- Modify: `evals/alex-conversation/fixtures/gen-booking.jsonl` (append 1 fixture)

- [ ] **Step 8.1: Append a booking fixture** where the lead phrases the service loosely and the canonical playbook name is "Botox". Graded via judge `mustDo` + oracle `expectsBooking:true`. (continue-on-error + needs ANTHROPIC_API_KEY; do not block on flake.) Exact JSONL row (one line):

```json
{
  "id": "booking-canonical-name-botox",
  "vertical": "medspa",
  "locale": "sg",
  "scenario": "Lead asks for 'anti-wrinkle jabs'; Alex must book using the canonical bookable-service name 'Botox'.",
  "businessFacts": "operator",
  "playbook": "operator",
  "mockBooking": "success",
  "stage": "booking",
  "tags": ["d3-1", "booked-value", "canonical-name"],
  "turns": [
    { "role": "lead", "content": "can i book the anti-wrinkle jabs for this week?" },
    {
      "role": "alex",
      "grade": {
        "mustDo": [
          "offer available appointment times",
          "when calling the booking tool, use the exact bookable service name 'Botox'"
        ],
        "mustNot": ["invent a service name not in the bookable services list"]
      }
    }
  ],
  "oracle": { "expectsBooking": true, "expectedTools": ["calendar-book"] }
}
```

- [ ] **Step 8.2: Validate structurally** — run `schema.test.ts` + `load-fixtures.test.ts` + `matrix.test.ts`. Expected: PASS (fixture count stays within 60-95; booking-stage + expectsBooking minimums still met). If count would exceed 95, this fixture replaces a redundant booking fixture instead of adding (decide at execution by reading the current count).
- [ ] **Step 8.3:** Optionally run the live eval if `ANTHROPIC_API_KEY` is set: `pnpm eval:alex-conversation` (continue-on-error; record outcome, do not gate on it). The SKILL.md change alters `skillContentHash`, so a baseline mismatch is expected and non-blocking.
- [ ] **Step 8.4: Commit** — `test(eval): add a canonical-name booking fixture for d3-1`

---

## Notes for the executor

- Run each package's tests with `--filter` for the package you touched. The repo-wide `pnpm test` + `CI=1 npx tsx scripts/local-verify-fast.ts` run at VERIFY.
- `local-verify-fast.ts` is the ONLY gate that catches a missing env/route allowlist entry; this slice adds NEITHER, but run it to prove that.
- No schema/Prisma migration in this slice (the playbook + business-facts JSON columns already exist). No new env var. No new mutating route.
- Do NOT touch the resolver (`booking-value.ts`) — widening it to fuzzy-match reintroduces fabrication.
- Keep files under 600 lines (arch:check errors at 600). `calendar-book.test.ts` is ~1388 lines but is a TEST file (arch:check is source `.ts`; confirm it is not counted — if it is, the added test is tiny).
