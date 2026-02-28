import type { FastifyPluginAsync } from "fastify";

export const cartridgesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/cartridges - List all registered cartridge manifests
  app.get("/", {
    schema: {
      description: "List all registered cartridge manifests with their action definitions.",
      tags: ["Cartridges"],
    },
  }, async (_request, reply) => {
    const ids = app.storageContext.cartridges.list();
    const manifests = ids
      .map((id) => {
        const cartridge = app.storageContext.cartridges.get(id);
        return cartridge?.manifest ?? null;
      })
      .filter(Boolean);

    return reply.code(200).send({ cartridges: manifests });
  });
};
