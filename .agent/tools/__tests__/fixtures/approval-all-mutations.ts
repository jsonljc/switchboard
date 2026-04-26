type Db = {
  approval: {
    create: (data: unknown) => Promise<void>;
    createMany: (data: unknown) => Promise<void>;
    update: (data: unknown) => Promise<void>;
    updateMany: (data: unknown) => Promise<void>;
    upsert: (data: unknown) => Promise<void>;
    delete: (data: unknown) => Promise<void>;
    deleteMany: (data: unknown) => Promise<void>;
  };
};

export async function handler(ctx: { db: Db }) {
  await ctx.db.approval.create({});
  await ctx.db.approval.createMany({});
  await ctx.db.approval.update({});
  await ctx.db.approval.updateMany({});
  await ctx.db.approval.upsert({});
  await ctx.db.approval.delete({});
  await ctx.db.approval.deleteMany({});
}
