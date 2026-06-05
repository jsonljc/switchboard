import { describe, it, expect } from "vitest";
import { buildSprite, mergeSprite, SPRITE_SIZE } from "../build-sprite";
import type { SpriteCommand, SpriteState, VariantBundle } from "../types";
import { ALEX_VARIANTS } from "../alex-variants";
import { RILEY_VARIANTS } from "../riley-variants";
import { MIRA_VARIANTS } from "../mira-variants";

describe("buildSprite", () => {
  it("returns a 24×24 grid of '.' characters when given no commands", () => {
    const grid = buildSprite([]);
    expect(grid).toHaveLength(SPRITE_SIZE);
    grid.forEach((row) => {
      expect(row).toHaveLength(SPRITE_SIZE);
      expect(row).toBe(".".repeat(SPRITE_SIZE));
    });
  });

  it("applies a rect command", () => {
    const commands: SpriteCommand[] = [["rect", 2, 3, 4, 2, "K"]];
    const grid = buildSprite(commands);
    expect(grid[3].substring(2, 6)).toBe("KKKK");
    expect(grid[4].substring(2, 6)).toBe("KKKK");
    expect(grid[5]).toBe(".".repeat(SPRITE_SIZE)); // outside rect
  });

  it("applies a row command and skips underscore + space placeholders", () => {
    const commands: SpriteCommand[] = [["row", 1, 0, "AB_CD EF"]];
    const grid = buildSprite(commands);
    expect(grid[1].substring(0, 8)).toBe("AB.CD.EF");
  });

  it("applies a col command", () => {
    const commands: SpriteCommand[] = [["col", 3, 1, "XYZ"]];
    const grid = buildSprite(commands);
    expect(grid[1][3]).toBe("X");
    expect(grid[2][3]).toBe("Y");
    expect(grid[3][3]).toBe("Z");
  });

  it("applies a px command", () => {
    const grid = buildSprite([["px", 10, 10, "M"]]);
    expect(grid[10][10]).toBe("M");
    expect(grid[10][9]).toBe(".");
  });

  it("applies a rows multi-row command", () => {
    const grid = buildSprite([["rows", 0, 0, ["AA", "BB", "CC"]]]);
    expect(grid[0].substring(0, 2)).toBe("AA");
    expect(grid[1].substring(0, 2)).toBe("BB");
    expect(grid[2].substring(0, 2)).toBe("CC");
  });

  it("ignores commands that draw off-grid (no crash)", () => {
    const grid = buildSprite([["px", 100, 100, "K"]]);
    expect(grid).toHaveLength(SPRITE_SIZE);
    grid.forEach((row) => expect(row).toBe(".".repeat(SPRITE_SIZE)));
  });
});

describe("mergeSprite", () => {
  it("overlays new pixels on a base grid", () => {
    const base = buildSprite([["rect", 0, 0, 24, 24, "K"]]);
    const merged = mergeSprite(base, [["px", 0, 0, "M"]]);
    expect(merged[0][0]).toBe("M");
    expect(merged[0][1]).toBe("K"); // base preserved
  });

  it("supports the clear command (overlay-only; sets cells to '.')", () => {
    const base = buildSprite([["rect", 0, 0, 24, 24, "K"]]);
    const merged = mergeSprite(base, [["clear", 0, 0, 2, 2]]);
    expect(merged[0][0]).toBe(".");
    expect(merged[0][1]).toBe(".");
    expect(merged[0][2]).toBe("K");
    expect(merged[2][0]).toBe("K");
  });
});

const STATES: readonly SpriteState[] = ["idle", "draft", "sleep", "won"];
const ALEX_KEYS = ["classic", "operator", "cozy", "agent"] as const;
const RILEY_KEYS = ["analyst", "trader", "bot"] as const;
const MIRA_KEYS = ["maker"];

function validateBundle(bundle: VariantBundle, expectedKeys: readonly string[]): void {
  expect(Object.keys(bundle).sort()).toEqual([...expectedKeys].sort());
  for (const key of expectedKeys) {
    const variant = bundle[key];
    expect(variant, `${key} variant missing`).toBeDefined();
    expect(typeof variant.name).toBe("string");
    expect(typeof variant.blurb).toBe("string");
    expect(Object.keys(variant.palette).length).toBeGreaterThan(0);
    for (const state of STATES) {
      const frames = variant.states[state];
      expect(frames, `${key}.${state} frames missing`).toBeDefined();
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.rows).toHaveLength(24);
        for (const row of frame.rows) expect(row).toHaveLength(24);
        expect(typeof frame.dur).toBe("number");
        expect(frame.dur).toBeGreaterThan(0);
        // Every non-transparent palette key in the frame must resolve.
        for (const row of frame.rows) {
          for (const ch of row) {
            if (ch === "." || ch === " ") continue;
            expect(
              variant.palette[ch],
              `${key}.${state}: unknown palette key '${ch}'`,
            ).toBeDefined();
          }
        }
      }
    }
  }
}

describe("ALEX_VARIANTS bundle shape", () => {
  it("contains classic | operator | cozy | agent with all 4 states each", () => {
    validateBundle(ALEX_VARIANTS, ALEX_KEYS);
  });
});

describe("RILEY_VARIANTS bundle shape", () => {
  it("contains analyst | trader | bot with all 4 states each (incl. dormant won state)", () => {
    validateBundle(RILEY_VARIANTS, RILEY_KEYS);
  });
});

describe("MIRA_VARIANTS bundle shape", () => {
  it("contains maker with all 4 states", () => {
    validateBundle(MIRA_VARIANTS, MIRA_KEYS);
  });
});
