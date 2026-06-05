// packages/creative-pipeline/src/creative-descriptor.ts
import { z } from "zod";
import { HookGeneratorOutput, ScriptWriterOutput, type HookType } from "@switchboard/schemas";

export interface CreativeDescriptor {
  mode: "polished" | "ugc";
  hookType: HookType | "none";
  /**
   * UGC only (slice-3 spec 3.4): the leading spec's structure id, the UGC
   * creative taxonomy (confession, demo_first, ...). OMITTED (never null/
   * undefined-keyed) for polished so exact-shape assertions stay valid.
   */
  structureId?: string;
}

// Minimal parse of the ugc scripting output: only what the descriptor needs.
const UgcScriptingForDescriptor = z.object({
  specs: z.array(z.object({ structureId: z.string() })).min(1),
});

/**
 * hookRef is a 0-based index STRING (script-writer prompt contract); legacy
 * fixtures carry non-numeric refs, so parse with a NaN guard and bounds check.
 */
function resolveHookRef(
  ref: string | undefined,
  hooks: HookGeneratorOutput["hooks"],
): HookType | null {
  if (ref === undefined) return null;
  const idx = parseInt(ref, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= hooks.length) return null;
  return hooks[idx]!.type;
}

/**
 * Deterministic, bounded descriptor for taste bucketing (slice-2 spec 3.5).
 * The LEADING hook opens the assembled composite video, which is the Keep/Pass
 * gesture's strongest signal. Fallback chain: scripts[0].hookRef ->
 * topCombos[0].hookRef -> hooks[0].type -> "none". Pure; never throws
 * (parse-don't-cast on every stage output).
 */
export function extractCreativeDescriptor(
  stageOutputs: unknown,
  mode: "polished" | "ugc",
): CreativeDescriptor {
  const outputs =
    stageOutputs !== null && typeof stageOutputs === "object"
      ? (stageOutputs as Record<string, unknown>)
      : {};

  // UGC vocabulary (slice-3 spec 3.4): callers pass ugcPhaseOutputs for ugc
  // jobs; the LEADING spec's structureId is the bucket axis (hooks do not
  // exist for ugc, so hookType stays "none").
  if (mode === "ugc") {
    const scripting = UgcScriptingForDescriptor.safeParse(outputs["scripting"]);
    return scripting.success
      ? { mode, hookType: "none", structureId: scripting.data.specs[0]!.structureId }
      : { mode, hookType: "none" };
  }

  const hooksParsed = HookGeneratorOutput.safeParse(outputs["hooks"]);
  if (!hooksParsed.success || hooksParsed.data.hooks.length === 0) {
    return { mode, hookType: "none" };
  }
  const hooks = hooksParsed.data;

  const scriptsParsed = ScriptWriterOutput.safeParse(outputs["scripts"]);
  const fromScript = scriptsParsed.success
    ? resolveHookRef(scriptsParsed.data.scripts[0]?.hookRef, hooks.hooks)
    : null;
  const fromCombo = resolveHookRef(hooks.topCombos[0]?.hookRef, hooks.hooks);

  return { mode, hookType: fromScript ?? fromCombo ?? hooks.hooks[0]!.type };
}
