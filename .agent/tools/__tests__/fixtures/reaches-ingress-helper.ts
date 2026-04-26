import { PlatformIngress } from "@switchboard/core";

export async function submitViaHelper() {
  await PlatformIngress.submit({});
}
