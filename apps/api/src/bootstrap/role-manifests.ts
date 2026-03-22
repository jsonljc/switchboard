import path from "node:path";
import fs from "node:fs/promises";
import type { AgentRoleManifest } from "@switchboard/schemas";
import { AgentRoleManifestSchema } from "@switchboard/schemas";
import type { RoleCheckpointValidator } from "@switchboard/core/sessions";
import { compileRoleCheckpointValidator } from "./compile-role-checkpoint-validator.js";

export interface LoadedManifest {
  manifest: AgentRoleManifest;
  instruction: string;
  checkpointSchema: unknown;
  /** Compiled JSON Schema validator, if schema was present and valid */
  checkpointValidate?: RoleCheckpointValidator;
  manifestDir: string;
}

/**
 * Load all role manifests from the agent-roles directory.
 *
 * Manifest files are JSON (not TypeScript) — each role directory contains
 * a `manifest.json` and a `defaults/` directory with instruction.md and
 * checkpoint-schema.json. This avoids the need for a TypeScript loader
 * at runtime.
 */
export async function loadRoleManifests(options?: {
  agentRolesDir?: string;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): Promise<Map<string, LoadedManifest>> {
  const baseDir = options?.agentRolesDir ?? path.resolve(process.cwd(), "../../agent-roles");
  const logger = options?.logger ?? console;

  const manifests = new Map<string, LoadedManifest>();

  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    logger.warn(`agent-roles directory not found at ${baseDir}, no manifests loaded`);
    return manifests;
  }

  for (const entry of entries) {
    const manifestPath = path.join(baseDir, entry, "manifest.json");
    try {
      await fs.access(manifestPath);
    } catch {
      continue; // Skip non-role directories (e.g., tsconfig.json)
    }

    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const parsed = AgentRoleManifestSchema.parse(JSON.parse(raw));

      const instructionPath = path.resolve(path.dirname(manifestPath), parsed.instructionPath);
      const instruction = await fs.readFile(instructionPath, "utf-8");

      const checkpointSchemaPath = path.resolve(
        path.dirname(manifestPath),
        parsed.checkpointSchemaPath,
      );
      let checkpointSchema: unknown = null;
      try {
        const schemaRaw = await fs.readFile(checkpointSchemaPath, "utf-8");
        checkpointSchema = JSON.parse(schemaRaw);
      } catch {
        logger.warn(`Checkpoint schema not found at ${checkpointSchemaPath}, using base schema`);
      }

      const checkpointValidate = compileRoleCheckpointValidator(checkpointSchema);

      manifests.set(parsed.id, {
        manifest: parsed,
        instruction,
        checkpointSchema,
        checkpointValidate,
        manifestDir: path.dirname(manifestPath),
      });

      logger.info(`Loaded role manifest: ${parsed.id} (v${parsed.version})`);
    } catch (err) {
      logger.warn(`Failed to load manifest from ${manifestPath}:`, err);
    }
  }

  return manifests;
}
