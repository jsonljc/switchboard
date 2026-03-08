import { describe, it, expect } from "vitest";
import { ToolRegistry } from "@switchboard/core";
import type { CartridgeManifest } from "@switchboard/schemas";
import { DIGITAL_ADS_MANIFEST } from "@switchboard/digital-ads";
import { QUANT_TRADING_MANIFEST } from "@switchboard/quant-trading";
import { PAYMENTS_MANIFEST } from "@switchboard/payments";
import { CRM_MANIFEST } from "@switchboard/crm";
import { CUSTOMER_ENGAGEMENT_MANIFEST } from "@switchboard/customer-engagement";

/**
 * Cross-cutting schema/contract tests that validate invariants
 * across ALL cartridge manifests. These prevent regressions
 * that individual cartridge tests would miss.
 */

const ALL_MANIFESTS: Array<{ id: string; manifest: CartridgeManifest }> = [
  { id: "digital-ads", manifest: DIGITAL_ADS_MANIFEST as CartridgeManifest },
  { id: "quant-trading", manifest: QUANT_TRADING_MANIFEST as CartridgeManifest },
  { id: "payments", manifest: PAYMENTS_MANIFEST as CartridgeManifest },
  { id: "crm", manifest: CRM_MANIFEST as CartridgeManifest },
  { id: "customer-engagement", manifest: CUSTOMER_ENGAGEMENT_MANIFEST as CartridgeManifest },
];

/** Action types that are read-only / diagnostic and legitimately have "none" risk. */
const READ_ONLY_PATTERNS = [
  /\.search$/,
  /\.list$/,
  /\.get$/,
  /\.diagnose$/,
  /\.analyze$/,
  /\.fetch$/,
  /\.status$/,
  /\.connect$/,
  /\.check$/,
  /\.score$/, // scoring operations (read-only computation)
  /\.score_ltv$/, // LTV scoring
  /\.qualify$/, // lead qualification (read-only classification)
  /\.handle_objection$/, // conversation handling (read-only NLP)
  /\.escalate$/, // escalation routing (no side-effect)
  /\.insights$/, // read-only aggregation/analysis
  /\.recommend$/, // read-only recommendation computation
  /\.export$/, // read-only data export
  /\.estimate$/, // read-only estimation
  /\.compare$/, // read-only comparison
  /\.compute$/, // read-only computation
  /\.power$/, // read-only power analysis
  /\.design$/, // read-only experiment design
  /\.events$/, // read-only event listing
  /\.calendar$/, // read-only calendar lookup
];

function isReadOnly(actionType: string): boolean {
  return READ_ONLY_PATTERNS.some((p) => p.test(actionType));
}

describe("Cross-cartridge contract tests", () => {
  describe("Contract 1: Every cartridge manifest validates without structural errors", () => {
    for (const { id, manifest } of ALL_MANIFESTS) {
      it(`${id} manifest has valid structure (id, name, version, description)`, () => {
        expect(manifest.id).toBeTruthy();
        expect(manifest.name).toBeTruthy();
        expect(manifest.version).toBeTruthy();
        expect(manifest.description).toBeTruthy();
      });

      it(`${id} manifest has at least one action`, () => {
        expect(manifest.actions.length).toBeGreaterThan(0);
      });

      it(`${id} manifest actions all have required fields`, () => {
        for (const action of manifest.actions) {
          expect(action.actionType).toBeTruthy();
          expect(action.name).toBeTruthy();
          expect(action.description).toBeTruthy();
          expect(action.baseRiskCategory).toBeTruthy();
          expect(typeof action.reversible).toBe("boolean");
        }
      });

      it(`${id} manifest actions all have valid parametersSchema`, () => {
        for (const action of manifest.actions) {
          // parametersSchema must be defined and be a valid Zod-like schema
          expect(action.parametersSchema).toBeDefined();
          expect(typeof action.parametersSchema).toBe("object");
        }
      });
    }
  });

  describe("Contract 2: No duplicate action types across cartridges", () => {
    it("ToolRegistry.findDuplicates() returns empty for all cartridges", () => {
      const registry = new ToolRegistry();
      for (const { id, manifest } of ALL_MANIFESTS) {
        registry.registerCartridge(id, manifest);
      }
      const duplicates = registry.findDuplicates();
      if (duplicates.length > 0) {
        console.error("Duplicate action types found:", duplicates);
      }
      expect(duplicates).toHaveLength(0);
    });

    it("all action types are globally unique (manual check)", () => {
      const seen = new Map<string, string>();
      for (const { id, manifest } of ALL_MANIFESTS) {
        for (const action of manifest.actions) {
          const existing = seen.get(action.actionType);
          if (existing) {
            throw new Error(
              `Duplicate actionType "${action.actionType}" found in both "${existing}" and "${id}"`,
            );
          }
          seen.set(action.actionType, id);
        }
      }
      expect(seen.size).toBeGreaterThan(0);
    });
  });

  describe("Contract 3: Side-effect actions declare non-zero risk", () => {
    for (const { id, manifest } of ALL_MANIFESTS) {
      const writeActions = manifest.actions.filter((a) => !isReadOnly(a.actionType));

      for (const action of writeActions) {
        it(`${id}: "${action.actionType}" (mutation) has risk category != "none"`, () => {
          expect(action.baseRiskCategory).not.toBe("none");
        });
      }

      // Informational: verify read-only actions exist (they CAN have "none" risk)
      const readActions = manifest.actions.filter((a) => isReadOnly(a.actionType));
      if (readActions.length > 0) {
        it(`${id}: has ${readActions.length} read-only actions (risk check skipped)`, () => {
          expect(readActions.length).toBeGreaterThan(0);
        });
      }
    }
  });

  describe("Contract 4: Action type naming conventions", () => {
    for (const { id, manifest } of ALL_MANIFESTS) {
      for (const action of manifest.actions) {
        it(`${id}: "${action.actionType}" follows dotted naming convention`, () => {
          // Must have at least 2 segments: "cartridge.verb" or "cartridge.entity.verb"
          const segments = action.actionType.split(".");
          expect(segments.length).toBeGreaterThanOrEqual(2);
          // No empty segments
          for (const seg of segments) {
            expect(seg.length).toBeGreaterThan(0);
          }
        });
      }
    }
  });

  describe("Contract 5: Total action count sanity check", () => {
    it("all cartridges combined have 30+ actions", () => {
      const totalActions = ALL_MANIFESTS.reduce(
        (sum, { manifest }) => sum + manifest.actions.length,
        0,
      );
      expect(totalActions).toBeGreaterThanOrEqual(30);
    });
  });
});
