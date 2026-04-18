import { z } from "zod";

export const ConversionStageSchema = z.enum([
  "inquiry",
  "qualified",
  "booked",
  "purchased",
  "completed",
]);
export type ConversionStage = z.infer<typeof ConversionStageSchema>;
