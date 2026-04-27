import { submitViaHelper } from "./reaches-ingress-helper.js";

export const handler = async () => {
  await submitViaHelper();
};
