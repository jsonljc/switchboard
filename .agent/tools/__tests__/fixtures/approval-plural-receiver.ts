export async function handler(ctx: { db: { approvals: { update: (data: unknown) => Promise<void> } } }) {
  await ctx.db.approvals.update({ status: "approved" });
}
