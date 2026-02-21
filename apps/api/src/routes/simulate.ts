import type { FastifyPluginAsync } from "fastify";

export const simulateRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/simulate - Dry-run action evaluation
  app.post("/", async (_request, reply) => {
    // In production, would run the full policy engine in simulation mode
    // No side effects, no audit entry
    return reply.code(200).send({
      wouldExecute: false,
      approvalRequired: "standard",
      explanation: "Simulation mode: action not evaluated (no engine configured)",
      decisionTrace: {
        actionId: "sim",
        envelopeId: "sim",
        checks: [],
        computedRiskScore: {
          rawScore: 0,
          category: "none",
          factors: [],
        },
        finalDecision: "allow",
        approvalRequired: "none",
        explanation: "Simulation placeholder",
        evaluatedAt: new Date().toISOString(),
      },
    });
  });
};
