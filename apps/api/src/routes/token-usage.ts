import type { FastifyPluginAsync } from "fastify";
import { computeTokenCostUSD, listModelCosts } from "@switchboard/core";

const COST_PRECISION = 1_000_000;

export const tokenUsageRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/token-usage?period=daily|weekly|monthly
  app.get("/", {
    schema: {
      description: "Get token usage summary with estimated costs for the authenticated organization.",
      tags: ["Token Usage"],
      querystring: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["daily", "weekly", "monthly"], default: "daily" },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { period?: string };
    const period = query.period ?? "daily";
    const orgId = request.organizationIdFromAuth ?? "default";
    const redis = app.redis;

    if (!redis) {
      return reply.code(200).send({
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
        period,
        orgId,
      });
    }

    try {
      const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
      const tokenKeys = buildDayKeys(orgId, days);
      const costKeys = buildCostDayKeys(orgId, days);

      let promptTokens = 0;
      let completionTokens = 0;
      let totalMicroDollars = 0;

      const pipeline = redis.pipeline();
      for (const key of tokenKeys) {
        pipeline.hgetall(key);
      }
      for (const key of costKeys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      if (results) {
        for (let i = 0; i < tokenKeys.length; i++) {
          const [err, data] = results[i] ?? [null, null];
          if (err || !data) continue;
          const hash = data as Record<string, string>;
          promptTokens += parseInt(hash["prompt"] ?? "0", 10) || 0;
          completionTokens += parseInt(hash["completion"] ?? "0", 10) || 0;
        }
        for (let i = tokenKeys.length; i < tokenKeys.length + costKeys.length; i++) {
          const [err, data] = results[i] ?? [null, null];
          if (err || !data) continue;
          totalMicroDollars += parseInt(data as string, 10) || 0;
        }
      }

      // If no cost data in Redis yet, estimate from tokens using default model
      const estimatedCostUSD = totalMicroDollars > 0
        ? totalMicroDollars / COST_PRECISION
        : computeTokenCostUSD(promptTokens, completionTokens).totalCost;

      return reply.code(200).send({
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimatedCostUSD: Math.round(estimatedCostUSD * 1_000_000) / 1_000_000,
        },
        period,
        orgId,
      });
    } catch (err) {
      app.log.error({ err }, "Failed to fetch token usage");
      return reply.code(200).send({
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
        period,
        orgId,
      });
    }
  });

  // GET /api/token-usage/trend?days=7|14|30
  app.get("/trend", {
    schema: {
      description: "Get daily token usage trend with costs for the authenticated organization.",
      tags: ["Token Usage"],
      querystring: {
        type: "object",
        properties: {
          days: { type: "integer", default: 7 },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { days?: string };
    const days = Math.min(parseInt(query.days ?? "7", 10) || 7, 90);
    const orgId = request.organizationIdFromAuth ?? "default";
    const redis = app.redis;

    if (!redis) {
      return reply.code(200).send({
        trend: buildEmptyTrend(days),
        orgId,
      });
    }

    try {
      const trend: Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number }> = [];
      const now = new Date();
      const tokenKeys: string[] = [];
      const costKeys: string[] = [];
      const dates: string[] = [];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        dates.push(dateStr);
        tokenKeys.push(`tokenusage:${orgId}:${dateStr}`);
        costKeys.push(`tokencost:${orgId}:${dateStr}`);
      }

      const pipeline = redis.pipeline();
      for (const key of tokenKeys) {
        pipeline.hgetall(key);
      }
      for (const key of costKeys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dates.length; i++) {
        const [tokenErr, tokenData] = results?.[i] ?? [null, null];
        const [costErr, costData] = results?.[i + dates.length] ?? [null, null];

        let prompt = 0;
        let completion = 0;
        let microDollars = 0;

        if (!tokenErr && tokenData) {
          const hash = tokenData as Record<string, string>;
          prompt = parseInt(hash["prompt"] ?? "0", 10) || 0;
          completion = parseInt(hash["completion"] ?? "0", 10) || 0;
        }

        if (!costErr && costData) {
          microDollars = parseInt(costData as string, 10) || 0;
        }

        const estimatedCostUSD = microDollars > 0
          ? microDollars / COST_PRECISION
          : computeTokenCostUSD(prompt, completion).totalCost;

        trend.push({
          date: dates[i]!,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: prompt + completion,
          estimatedCostUSD: Math.round(estimatedCostUSD * 1_000_000) / 1_000_000,
        });
      }

      return reply.code(200).send({ trend, orgId });
    } catch (err) {
      app.log.error({ err }, "Failed to fetch token usage trend");
      return reply.code(200).send({
        trend: buildEmptyTrend(days),
        orgId,
      });
    }
  });

  // GET /api/token-usage/models — list all models with cost data
  app.get("/models", {
    schema: {
      description: "List all supported LLM models with their per-token costs.",
      tags: ["Token Usage"],
    },
  }, async (_request, reply) => {
    return reply.code(200).send({ models: listModelCosts() });
  });
};

function buildDayKeys(orgId: string, days: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(`tokenusage:${orgId}:${d.toISOString().slice(0, 10)}`);
  }
  return keys;
}

function buildCostDayKeys(orgId: string, days: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(`tokencost:${orgId}:${d.toISOString().slice(0, 10)}`);
  }
  return keys;
}

function buildEmptyTrend(days: number): Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number }> {
  const trend: Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUSD: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    trend.push({ date: d.toISOString().slice(0, 10), promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 });
  }
  return trend;
}
