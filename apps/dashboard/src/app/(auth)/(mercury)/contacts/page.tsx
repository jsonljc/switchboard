import type { Metadata } from "next";
import { ContactsPage } from "./contacts-page";

export const metadata: Metadata = {
  title: "Contacts — Switchboard",
  description: "Read-only register of people captured by Switchboard.",
};

export default function ContactsRoute() {
  return <ContactsPage />;
}
