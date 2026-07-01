import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SkillValidationError } from "./types.js";

/**
 * Pack marker: `<!-- @pack:<slot> -->`. Whitespace around the directive is
 * tolerated; the slot is kebab-case. Left untouched by the template engine
 * (which matches only `{{...}}`), so an un-spliced marker leaks verbatim into the
 * prompt (a detectable failure) rather than silently vanishing.
 */
const PACK_MARKER = /<!--\s*@pack:([a-z][a-z0-9-]*)\s*-->/g;

/**
 * Splice a skill's vertical pack blocks into its (vertical-agnostic) skeleton
 * body at load time. Each `<!-- @pack:<slot> -->` marker is replaced by the
 * bytes of `<packDir>/<slot>.md`.
 *
 * FAIL-CLOSED, always: called unconditionally by loadSkill so an orphan marker
 * (no `pack:` declared -> `packDir` undefined) throws just like a missing pack
 * file. A safety block must never render empty (or as a literal comment) into
 * live traffic because a pack was mis-wired; it fails loudly at load / preflight.
 * A body with no markers is returned unchanged (every non-pack skill is a no-op).
 *
 * The pack file is treated as a block: one trailing newline (the editor/prettier
 * convention on `*.md`) is stripped so the block splices inline byte-identically.
 */
export function composePackBody(body: string, packDir: string | undefined): string {
  return body.replace(PACK_MARKER, (_match, slot: string) => {
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
    return readFileSync(file, "utf-8").replace(/\n$/, "");
  });
}
