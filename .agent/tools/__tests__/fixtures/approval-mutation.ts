export async function handler(ctx: { db: { approval: { create: (data: unknown) => Promise<void> } } }) {
  await ctx.db.approval.create({ status: "pending" });
}
