# Alex PR-1: Multi-turn tool-name fix (Critical 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Alex from 400ing on multi-turn tool use by re-encoding tool-use names in the Anthropic adapter's _outgoing message history_, and add a loud guard so future tool-name drift fails locally instead of as a live 400.

**Architecture:** The skill executor keeps tool names dotted internally (`crm-query.contact.get`, for `name.split(".")` parsing); the `AnthropicToolAdapter` is the sole API boundary that encodes `.`→`__`. Today it encodes tool _definitions_ and decodes _incoming_ blocks but maps _outgoing message history_ verbatim — so an assistant `tool_use` block the executor pushed back into history (dotted) is re-sent with a dot and rejected. The fix re-encodes `tool_use` names in the outgoing message map (type-guarded walk) and validates every encoded name against Anthropic's `^[a-zA-Z0-9_-]{1,128}$`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, `@anthropic-ai/sdk`. Spec: `docs/superpowers/specs/2026-05-25-alex-live-integration-fixes-design.md` §3. Scope: ONE file + its test. Do NOT touch `SkillMode`, the eval, or any other adapter (that is PR-2 / out of scope).

**Branch/base:** create from an up-to-date `origin/main` (`git fetch origin main && git switch -c feat/alex-tool-name-multiturn origin/main`). Adapter-only; independent of PR-2.

---

## File Structure

- Modify: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts` — add `assertValidAnthropicToolName`; validate the encoded output inside `encodeToolName`; re-encode `tool_use` names in the outgoing message map via a type-guarded walk; one-line stale-comment cleanup.
- Modify: `packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts` — add the encoded-name validation test and the outgoing-history multi-turn regression test.

---

## Task 1: Validate the encoded tool name (loud guard)

**Files:**

- Modify: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts`
- Test: `packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts`

`encodeToolName` already throws when the _source_ contains `__` (decode-symmetry guard). We add a second, complementary guard: the _encoded output_ must satisfy Anthropic's full tool-name pattern, so a future tool id/op with an API-illegal character (e.g. a space) fails loudly here instead of as a live 400.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("encodeToolName", ...)` block (after the `__` test, ~line 33):

```ts
describe("encodeToolName encoded-output validation", () => {
  it("throws when the encoded name violates Anthropic's tool-name pattern", () => {
    // A space survives "."→"__" encoding and breaks ^[a-zA-Z0-9_-]{1,128}$
    expect(() => encodeToolName("bad name.op")).toThrow(/violates Anthropic/);
  });

  it("accepts a normal dotted tool name (encodes cleanly)", () => {
    expect(encodeToolName("crm-query.contact.get")).toBe("crm-query__contact__get");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @switchboard/core test anthropic-tool-adapter`
Expected: the new "throws when the encoded name violates" test FAILS (no validation today — `encodeToolName("bad name.op")` returns `"bad name__op"` without throwing).

- [ ] **Step 3: Implement the guard**

In `anthropic-tool-adapter.ts`, add the pattern + guard near the top (after the existing comment block, before `encodeToolName`):

```ts
// Anthropic tool names must match this exactly (name field on tool definitions
// AND on tool_use blocks in message history).
const ANTHROPIC_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Throw if an ENCODED tool name would be rejected by the Anthropic API. Call
 * this on the post-encoding result so future naming drift (a tool id/op with an
 * API-illegal character, or a name >128 chars) fails loudly in tests/at boot
 * rather than as a live 400 mid-conversation.
 */
function assertValidAnthropicToolName(encoded: string): void {
  if (!ANTHROPIC_TOOL_NAME_RE.test(encoded)) {
    throw new Error(
      `[AnthropicToolAdapter] encoded tool name "${encoded}" violates Anthropic's ` +
        `^[a-zA-Z0-9_-]{1,128}$ pattern. Tool ids/operations must encode to that ` +
        `charset; fix the source name or the encoding scheme before relaxing this guard.`,
    );
  }
}
```

Then, in `encodeToolName`, validate the encoded value before returning it (keep the existing `__`-source guard):

```ts
export function encodeToolName(name: string): string {
  if (name.includes("__")) {
    throw new Error(
      `[AnthropicToolAdapter] encodeToolName: source tool name "${name}" already contains "__". Choose a different separator or pre-sanitize the name.`,
    );
  }
  const encoded = name.replace(/\./g, "__");
  assertValidAnthropicToolName(encoded);
  return encoded;
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm --filter @switchboard/core test anthropic-tool-adapter`
Expected: all `encodeToolName` / `decodeToolName` / round-trip tests PASS (the existing valid-name tests still encode unchanged; the new illegal-name test now throws).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts
git commit -m "fix(core): validate encoded tool name against Anthropic pattern"
```

---

## Task 2: Re-encode tool-use names in outgoing message history (the fix)

**Files:**

- Modify: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts`
- Test: `packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts`

The executor pushes decoded (dotted) assistant `tool_use` blocks into history (`skill-executor.ts:333`) and re-sends the whole `messages` array each turn. The adapter currently maps `params.messages` verbatim (`anthropic-tool-adapter.ts:68-71`), so turn ≥2 sends a dotted `tool_use` name → 400. This task adds the missing test (the exact gap that let #668 ship incomplete) and the re-encode walk.

- [ ] **Step 1: Write the failing test**

Add inside `describe("AnthropicToolAdapter", ...)` (after the existing "decodes tool_use block names in the response" test, ~line 166):

```ts
it("re-encodes dotted tool_use names in OUTGOING message history (multi-turn fix)", async () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "all set" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const adapter = new AnthropicToolAdapter({ messages: { create: mockCreate } } as never);

  await adapter.chatWithTools({
    system: "s",
    messages: [
      { role: "user", content: "Book me in" },
      // Turn-1 assistant tool_use, exactly as the executor stores it: DECODED (dotted).
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "calendar-book.booking.create",
            input: { slot: "x" },
          },
        ],
      },
      // Turn-1 tool_result — carries tool_use_id (no name) and must pass through.
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
    ],
    tools: [
      {
        name: "calendar-book.booking.create",
        description: "Book",
        input_schema: { type: "object", properties: {} },
      },
    ],
  });

  const sent = mockCreate.mock.calls[0]![0] as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const assistantBlocks = sent.messages[1]!.content as Array<{ type: string; name?: string }>;
  expect(assistantBlocks[0]!.name).toBe("calendar-book__booking__create");
  expect(assistantBlocks[0]!.name).not.toContain(".");

  const resultBlocks = sent.messages[2]!.content as Array<{ type: string; tool_use_id?: string }>;
  expect(resultBlocks[0]!.type).toBe("tool_result");
  expect(resultBlocks[0]!.tool_use_id).toBe("tu_1");
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @switchboard/core test anthropic-tool-adapter`
Expected: FAIL — the assistant block name is `"calendar-book.booking.create"` (verbatim, still dotted), not the encoded form.

- [ ] **Step 3: Implement the type-guarded outgoing walk**

In `anthropic-tool-adapter.ts`, add a helper above the class. It needs `LLMMessage`, `LLMContentBlock`, and `LLMToolResultBlock` from `../llm-types.js`. `LLMMessage` + `LLMContentBlock` are already imported there; **add `type LLMToolResultBlock` to that existing import block** (it is exported from `llm-types.ts` but not yet imported in this file):

```ts
/**
 * Map a provider-neutral message's content to the Anthropic wire shape, encoding
 * tool_use names ("."→"__") so multi-turn history satisfies the API tool-name
 * pattern. Outgoing content is constructed by our executor (decoded blocks),
 * so non-tool_use blocks (text, tool_result) pass through unchanged.
 */
function encodeOutgoingContent(content: LLMMessage["content"]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  // Exhaustive block handling: encode tool_use names; pass text/tool_result
  // through; THROW on any unknown block so a future shape can't silently bypass
  // encoding (mirrors the response-side LLMAdapterShapeMismatchError discipline).
  // The array narrowing is only to make `.map` callable over the union-of-arrays;
  // the real guard is the exhaustive switch below.
  return (content as Array<LLMContentBlock | LLMToolResultBlock>).map((block) => {
    if (block.type === "tool_use") {
      return { ...block, name: encodeToolName(block.name) };
    }
    if (block.type === "text" || block.type === "tool_result") {
      return block;
    }
    throw new Error(
      `[AnthropicToolAdapter] unsupported outgoing content block: ${JSON.stringify(block)}`,
    );
  }) as Anthropic.MessageParam["content"];
}
```

Then replace the verbatim message map in `chatWithTools` (currently `anthropic-tool-adapter.ts:68-71`):

```ts
const anthropicMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
  role: m.role,
  content: encodeOutgoingContent(m.content),
}));
```

While here, fix the now-stale comment block at `:12-15` (it warns about a literal that no longer lives in the referenced file) — replace its body with a one-line note that `encodeToolName`/`decodeToolName` are the sole `.`↔`__` boundary for both tool definitions and message history. Do NOT touch `agent-runtime/anthropic-adapter.ts` (unrelated, out of scope).

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm --filter @switchboard/core test anthropic-tool-adapter`
Expected: PASS — the new outgoing-history test passes; the existing single-turn encode, incoming-decode, and round-trip tests stay green.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS.

```bash
git add packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts packages/core/src/skill-runtime/__tests__/anthropic-tool-adapter.test.ts
git commit -m "fix(core): re-encode tool_use names in outgoing message history (multi-turn 400)"
```

---

## Self-review checklist (run before handoff)

- Spec coverage (§3): re-encode outgoing `tool_use` names (Task 2) ✓; type-guarded walk, not a blind cast (Task 2 Step 3) ✓; `assertValidAnthropicToolName` validating the ENCODED output (Task 1) ✓; the ≥2-turn outgoing-history regression test (Task 2 Step 1) ✓; comment cleanup (Task 2 Step 3) ✓.
- Scope fence: only `anthropic-tool-adapter.ts` + its test touched; no `SkillMode` / eval / other-adapter changes.
- Type consistency: `encodeToolName` signature unchanged (still `(string) => string`); `encodeOutgoingContent` is internal; `assertValidAnthropicToolName` is internal (tested via `encodeToolName`).
- No placeholders; every step has exact code, command, and expected output.
- `.js` import extensions on relative imports; Prettier (double quotes, semis, 100 width).
