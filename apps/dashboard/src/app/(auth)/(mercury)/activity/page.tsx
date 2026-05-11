import type { Metadata } from "next";
import { ActivityPage } from "./activity-page";

export const metadata: Metadata = {
  title: "Activity · Switchboard",
};

export default function ActivityRoute() {
  return <ActivityPage />;
}
