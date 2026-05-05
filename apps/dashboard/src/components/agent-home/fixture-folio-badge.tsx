import type { DataSource } from "@/lib/agent-home/types";

export function FixtureFolioBadge({ dataSource }: { dataSource: DataSource }) {
  if (dataSource !== "fixture") return null;
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") return null;
  return <span> · FIXTURE</span>;
}
