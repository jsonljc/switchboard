import { redirect } from "next/navigation";

// The /riley cockpit was retired in favor of the read-only agent panel. This route
// redirects to Home's `?agent=` deep-link, which auto-opens the Riley panel.
export default async function RileyPage() {
  redirect("/?agent=riley");
}
