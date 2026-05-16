import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtures } from "../load-fixtures.js";

describe("loadFixtures", () => {
  it("loads all *.jsonl files in a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    try {
      writeFileSync(
        join(dir, "a.jsonl"),
        '{"id":"a1","text":"x","language":"en","jurisdiction":"SG","expectedClaimType":"none"}\n',
      );
      writeFileSync(
        join(dir, "b.jsonl"),
        '{"id":"b1","text":"y","language":"en","jurisdiction":"MY","expectedClaimType":"efficacy"}\n',
      );
      const rows = loadFixtures(dir);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual(["a1", "b1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores non-jsonl files", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    try {
      writeFileSync(
        join(dir, "a.jsonl"),
        '{"id":"a1","text":"x","language":"en","jurisdiction":"SG","expectedClaimType":"none"}\n',
      );
      writeFileSync(join(dir, "README.md"), "not a fixture");
      expect(loadFixtures(dir)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips blank lines and #-prefixed comment lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    try {
      writeFileSync(
        join(dir, "a.jsonl"),
        '# comment\n\n{"id":"a1","text":"x","language":"en","jurisdiction":"SG","expectedClaimType":"none"}\n\n',
      );
      expect(loadFixtures(dir)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on duplicate fixture id", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    try {
      writeFileSync(
        join(dir, "a.jsonl"),
        '{"id":"dup","text":"x","language":"en","jurisdiction":"SG","expectedClaimType":"none"}\n' +
          '{"id":"dup","text":"y","language":"en","jurisdiction":"SG","expectedClaimType":"none"}\n',
      );
      expect(() => loadFixtures(dir)).toThrow(/duplicate fixture id: dup/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws with file:line context on schema violation", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    try {
      writeFileSync(
        join(dir, "a.jsonl"),
        '{"id":"a1","text":"x","language":"en","jurisdiction":"US","expectedClaimType":"none"}\n',
      );
      expect(() => loadFixtures(dir)).toThrow(/a\.jsonl:1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
