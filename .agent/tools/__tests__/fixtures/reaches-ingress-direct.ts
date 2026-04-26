import { PlatformIngress } from "@switchboard/core";

export const handler = async () => {
  await PlatformIngress.submit({});
};
