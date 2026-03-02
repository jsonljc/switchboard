import type { FastifyPluginAsync } from "fastify";

export const tokenUsageRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/token-usage?period=daily|weekly|monthly
  app.get("/", {
    schema: {
      description: "Get token usage summary for the authenticated organization.",
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
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        period,
        orgId,
      });
    }

    try {
      const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
      const keys = buildDayKeys(orgId, days);

      let promptTokens = 0;
      let completionTokens = 0;

      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.hgetall(key);
      }
      const results = await pipeline.exec();

      if (results) {
        for (const [err, data] of results) {
          if (err || !data) continue;
          const hash = data as Record<string, string>;
          promptTokens += parseInt(hash["prompt"] ?? "0", 10) || 0;
          completionTokens += parseInt(hash["completion"] ?? "0", 10) || 0;
        }
      }

      return reply.code(200).send({
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        period,
        orgId,
      });
    } catch (err) {
      app.log.error({ err }, "Failed to fetch token usage");
      return reply.code(200).send({
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        period,
        orgId,
      });
    }
  });

  // GET /api/token-usage/trend?days=7|14|30
  app.get("/trend", {
    schema: {
      description: "Get daily token usage trend for the authenticated organization.",
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
      const trend: Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number }> = [];
      const now = new Date();
      const keys: string[] = [];
      const dates: string[] = [];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        dates.push(dateStr);
        keys.push(`tokenusage:${orgId}:${dateStr}`);
      }

      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.hgetall(key);
      }
      const results = await pipeline.exec();

      for (let i = 0; i < dates.length; i++) {
        const [err, data] = results?.[i] ?? [null, null];
        if (err || !data) {
          trend.push({ date: dates[i]!, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
          continue;
        }
        const hash = data as Record<string, string>;
        const prompt = parseInt(hash["prompt"] ?? "0", 10) || 0;
        const completion = parseInt(hash["completion"] ?? "0", 10) || 0;
        trend.push({
          date: dates[i]!,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: prompt + completion,
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

function buildEmptyTrend(days: number): Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number }> {
  const trend: Array<{ date: string; promptTokens: number; completionTokens: number; totalTokens: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    trend.push({ date: d.toISOString().slice(0, 10), promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }
  return trend;
}
