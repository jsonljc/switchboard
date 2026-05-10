import type { Metadata } from "next";
import { ReportsPage } from "./reports-page";

export const metadata: Metadata = {
  title: "Reports — Switchboard",
  description: "Renewal-checkpoint statement: attribution, funnel, campaigns, cost vs value.",
};

export default function ReportsRoute() {
  return <ReportsPage />;
}
