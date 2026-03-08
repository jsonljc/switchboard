// ---------------------------------------------------------------------------
// Experiment handlers — A/B testing experiments (reads + writes)
// ---------------------------------------------------------------------------

import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { MetaStudiesClient } from "../../ab-testing/meta-studies-client.js";
import type { CreateAdStudyWriteParams } from "../types.js";

export const experimentHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  [
    "digital-ads.experiment.check",
    async (params, ctx) => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const client = new MetaStudiesClient(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const studyId = params.studyId as string;
        if (!studyId) return fail("Missing studyId", "validation", "studyId is required");
        const study = await client.get(studyId);
        return success(
          `Experiment "${study.name}": status=${study.status}, ${study.cells.length} cell(s)`,
          study,
          start,
          { externalRefs: { studyId: study.id } },
        );
      } catch (err) {
        return fail(`Failed to check experiment: ${errMsg(err)}`, "experiment.check", errMsg(err));
      }
    },
  ],
  [
    "digital-ads.experiment.list",
    async (params, ctx) => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const client = new MetaStudiesClient(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const studies = await client.list(adAccountId);
        return success(`Listed ${studies.length} experiment(s)`, studies, start);
      } catch (err) {
        return fail(`Failed to list experiments: ${errMsg(err)}`, "experiment.list", errMsg(err));
      }
    },
  ],
  [
    "digital-ads.experiment.create",
    async (params, ctx) => {
      if (!ctx.writeProvider)
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      try {
        const p = params as unknown as CreateAdStudyWriteParams;
        const result = await ctx.writeProvider.createAdStudy(p);
        return success(`Created A/B test "${p.name}" (${result.id})`, undefined, Date.now(), {
          externalRefs: { studyId: result.id },
        });
      } catch (err) {
        return fail(
          `Failed to create experiment: ${errMsg(err)}`,
          "experiment.create",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.experiment.conclude",
    async (params, ctx) => {
      if (!ctx.writeProvider)
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      const studyId = params.studyId as string;
      const winnerCellId = params.winnerCellId as string;
      if (!studyId || !winnerCellId) {
        return fail(
          "Missing studyId or winnerCellId",
          "validation",
          "studyId and winnerCellId required",
        );
      }
      await ctx.writeProvider.concludeExperiment(studyId, winnerCellId);
      return success(
        `Concluded experiment ${studyId} — winner: ${winnerCellId}, losers paused`,
        undefined,
        Date.now(),
        { externalRefs: { studyId, winnerCellId } },
      );
    },
  ],
]);
