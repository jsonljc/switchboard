import type { Metadata } from "next";
import { AutomationsPage } from "./automations-page";

export const metadata: Metadata = {
  title: "Automations · Switchboard",
};

export default function Page() {
  return <AutomationsPage />;
}
