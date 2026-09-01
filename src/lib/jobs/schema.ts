/**
 * Job request schemas (gibson#1706 lane E3). Used by the console forms and
 * the /api/jobs routes, so both refuse the same input the daemon refuses:
 * an empty goal, an empty message, a wrap-up from a client, a score outside
 * 0..1, an unspecified verdict.
 */

import { z } from "zod";

export const openJobSchema = z.object({
  bankId: z.string().trim().min(1, "Bank is required"),
  /** Pins the job to one member. Empty lets the daemon pick. */
  memberId: z.string().trim(),
  goal: z.string().trim().min(1, "Say what the job must achieve"),
});

export const sendInputSchema = z.object({
  message: z.string().trim().min(1, "Type a message"),
  /** A client never sends wrap_up; the daemon does. */
  kind: z.enum(["turn", "answer"]),
});

export const closeJobSchema = z.object({
  verdict: z.enum(["accomplished", "failed"]),
  score: z.coerce.number().min(0, "Score is 0 to 1").max(1, "Score is 0 to 1"),
});

export type OpenJobValues = z.infer<typeof openJobSchema>;
export type SendInputValues = z.infer<typeof sendInputSchema>;
export type CloseJobValues = z.infer<typeof closeJobSchema>;
