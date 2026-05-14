import type { Metadata } from "next";
import { PipelinePage } from "./pipeline-page";

export const metadata: Metadata = {
  title: "Pipeline — Switchboard",
  description: "Every active deal across all eight stages.",
};

export default function ContactsRoute() {
  return <PipelinePage />;
}
