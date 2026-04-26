export async function handler(ctx: { db: { approval: { findFirst: () => Promise<unknown> } } }) {
  return ctx.db.approval.findFirst();
}
