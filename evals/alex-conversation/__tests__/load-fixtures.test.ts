import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConversationFixtures } from "../load-fixtures.js";

it("loads valid jsonl and rejects duplicate ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "alexfx-"));
  writeFileSync(
    join(dir, "a.jsonl"),
    JSON.stringify({
      id: "c1",
      vertical: "medspa",
      locale: "sg",
      scenario: "s",
      turns: [
        { role: "lead", content: "hi" },
        { role: "alex", grade: {} },
      ],
    }) + "\n",
  );
  expect(loadConversationFixtures(dir)).toHaveLength(1);
});

it("rejects duplicate fixture ids across files", () => {
  const dir = mkdtempSync(join(tmpdir(), "alexfx-"));
  const row = (id: string) =>
    JSON.stringify({
      id,
      vertical: "medspa",
      locale: "sg",
      scenario: "s",
      turns: [
        { role: "lead", content: "hi" },
        { role: "alex", grade: {} },
      ],
    });
  writeFileSync(join(dir, "a.jsonl"), row("dup") + "\n");
  writeFileSync(join(dir, "b.jsonl"), row("dup") + "\n");
  expect(() => loadConversationFixtures(dir)).toThrow(/duplicate/i);
});
