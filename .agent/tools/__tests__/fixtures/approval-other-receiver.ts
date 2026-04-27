export async function handler(ctx: { db: { user: { create: (data: unknown) => Promise<void> } } }) {
  await ctx.db.user.create({ name: "test" });
}
