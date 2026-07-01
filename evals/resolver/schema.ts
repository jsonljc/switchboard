import { z } from "zod";

/**
 * Resolver-routing eval fixture schema.
 *
 * A case pairs a natural-language task `input` with the `expected_skill` route
 * that `.agent/RESOLVER.md` documents for it. `expected_skill` is a FREE string on
 * purpose: the drift guard (in resolver-routes.ts), NOT this schema, is what asserts
 * the value names a real documented route. That way a drifted or renamed target
 * still parses cleanly here and then surfaces as a consistency MISMATCH rather than
 * a schema error, which is exactly what gives the drift guard teeth (a bad case must
 * be shape-valid yet flagged).
 */
export const ResolverCaseSchema = z.object({
  /** Natural-language task description a human would hand the resolver. */
  input: z.string().min(1),
  /** The route slug RESOLVER.md documents for this input (e.g. "architecture-audit"). */
  expected_skill: z.string().min(1),
});
export type ResolverCase = z.infer<typeof ResolverCaseSchema>;

export const ResolverDatasetSchema = z.array(ResolverCaseSchema);
export type ResolverDataset = z.infer<typeof ResolverDatasetSchema>;
