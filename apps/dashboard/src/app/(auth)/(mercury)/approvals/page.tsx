import type { Metadata } from "next";
import { ApprovalsPage } from "./approvals-page";

export const metadata: Metadata = {
  title: "Approvals — Switchboard",
  description: "Sign, modify, or block actions agents have proposed.",
};

export default function ApprovalsRoute() {
  return <ApprovalsPage />;
}
