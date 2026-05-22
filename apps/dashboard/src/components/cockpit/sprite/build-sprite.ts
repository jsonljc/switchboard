// Frame composition helpers ported from design's sprite.jsx:5-93.
// Test-only / future-author-only: product code consumes pre-built Frame arrays
// from alex-variants.ts / riley-variants.ts (which were authored by running
// the builders in the design canvas), not buildSprite calls at runtime.

import type { Frame, SpriteCommand } from "./types";

export const SPRITE_SIZE = 24;

function isSkip(ch: string | undefined): boolean {
  return ch === undefined || ch === "_" || ch === " ";
}

type SetPx = (x: number, y: number, c: string) => void;

function makeSetPx(grid: string[][]): SetPx {
  return (x: number, y: number, c: string): void => {
    if (x >= 0 && x < SPRITE_SIZE && y >= 0 && y < SPRITE_SIZE && c) {
      grid[y][x] = c;
    }
  };
}

function applyRect(
  setPx: SetPx,
  cmd: readonly ["rect", number, number, number, number, string],
): void {
  const [, x, y, w, h, c] = cmd;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(xx, yy, c);
  }
}

function applyRow(setPx: SetPx, cmd: readonly ["row", number, number, string]): void {
  const [, y, x, str] = cmd;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (!isSkip(ch)) setPx(x + i, y, ch);
  }
}

function applyCol(setPx: SetPx, cmd: readonly ["col", number, number, string]): void {
  const [, x, y, str] = cmd;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (!isSkip(ch)) setPx(x, y + i, ch);
  }
}

function applyRows(setPx: SetPx, cmd: readonly ["rows", number, number, readonly string[]]): void {
  const [, y, x, arr] = cmd;
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i] ?? "";
    for (let j = 0; j < row.length; j++) {
      const ch = row[j];
      if (!isSkip(ch)) setPx(x + j, y + i, ch);
    }
  }
}

function applyClear(setPx: SetPx, cmd: readonly ["clear", number, number, number, number]): void {
  const [, x, y, w, h] = cmd;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(xx, yy, ".");
  }
}

function applyCommand(grid: string[][], cmd: SpriteCommand): void {
  const setPx = makeSetPx(grid);
  switch (cmd[0]) {
    case "rect":
      applyRect(setPx, cmd);
      return;
    case "row":
      applyRow(setPx, cmd);
      return;
    case "col":
      applyCol(setPx, cmd);
      return;
    case "px": {
      const [, x, y, c] = cmd;
      setPx(x, y, c);
      return;
    }
    case "clear":
      applyClear(setPx, cmd);
      return;
    case "rows":
      applyRows(setPx, cmd);
      return;
  }
}

export function buildSprite(commands: readonly SpriteCommand[]): Frame {
  const grid: string[][] = Array.from({ length: SPRITE_SIZE }, () =>
    Array<string>(SPRITE_SIZE).fill("."),
  );
  for (const cmd of commands) applyCommand(grid, cmd);
  return grid.map((row) => row.join(""));
}

export function mergeSprite(base: Frame, commands: readonly SpriteCommand[]): Frame {
  const grid: string[][] = base.map((row) => row.split(""));
  for (const cmd of commands) applyCommand(grid, cmd);
  return grid.map((row) => row.join(""));
}
