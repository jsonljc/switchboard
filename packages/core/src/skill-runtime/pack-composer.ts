import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SkillValidationError } from "./types.js";

/**
 * Pack marker: `<!-- @pack:<slot> -->`. Whitespace around the directive is
 * tolerated. The slot is captured broadly (any non-space run) and then validated
 * to kebab-case, so a MALFORMED slot (wrong case, underscore, leading digit)
 * fails closed rather than leaking the literal comment into the prompt. The
 * template engine only touches `{{...}}`, so any marker would otherwise survive
 * verbatim; the broad capture lets us throw on a typo'd safety marker instead of
 * silently rendering a missing safety block.
 */
const PACK_MARKER = /<!--\s*@pack:(\S+?)\s*-->/g;
const VALID_SLOT = /^[a-z][a-z0-9-]*$/;

/**
 * Splice a skill's vertical pack blocks into its (vertical-agnostic) skeleton
 * body at load time. Each `<!-- @pack:<slot> -->` marker is replaced by the
 * bytes of `<packDir>/<slot>.md`.
 *
 * FAIL-CLOSED on every degenerate case, so a safety block can never render empty
 * (or as a literal comment) into live traffic because a pack was mis-wired. It
 * throws SkillValidationError at load / preflight for: a malformed slot name, an
 * orphan marker (no `pack:` declared, so `packDir` is undefined), a missing pack
 * file, and an empty or whitespace-only pack file. A body with no markers is
 * returned unchanged (every non-pack skill is a no-op).
 *
 * The pack file is treated as a block: one trailing newline (the editor/prettier
 * convention on `*.md`) is stripped so the block splices inline byte-identically.
 */
export function composePackBody(body: string, packDir: string | undefined): string {
  return body.replace(PACK_MARKER, (_match, slot: string) => {
    if (!VALID_SLOT.test(slot)) {
      throw new SkillValidationError(
        `Skill body has a malformed pack marker "@pack:${slot}" (slot must be kebab-case, matching ${VALID_SLOT.source})`,
        [`malformed pack marker: ${slot}`],
      );
    }
    if (!packDir) {
      throw new SkillValidationError(
        `Skill body references pack block "${slot}" but no pack is declared (frontmatter "pack:" missing)`,
        [`unresolved pack marker: ${slot}`],
      );
    }
    const file = join(packDir, `${slot}.md`);
    if (!existsSync(file)) {
      throw new SkillValidationError(
        `Skill body references pack block "${slot}" but ${file} does not exist`,
        [`missing pack file: ${file}`],
      );
    }
    const content = readFileSync(file, "utf-8").replace(/\n$/, "");
    if (content.trim() === "") {
      throw new SkillValidationError(`Pack block "${slot}" at ${file} is empty`, [
        `empty pack file: ${file}`,
      ]);
    }
    return content;
  });
}
