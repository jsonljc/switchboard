import type { Metadata } from "next";
import { OperatorReportsPage } from "./operator-reports-page";

export const metadata: Metadata = { title: "Operator Reports — Switchboard" };
export default function Page() {
  return <OperatorReportsPage />;
}
