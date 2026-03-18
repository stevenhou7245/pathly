import { z } from "zod";

const idSchema = z
  .string()
  .trim()
  .min(1, "ID is required.");

export const sendFriendRequestSchema = z.object({
  target_user_id: idSchema,
});

export const respondFriendRequestSchema = z.object({
  friendship_id: idSchema,
  action: z.enum(["accepted", "declined"], {
    message: "Action must be accepted or declined.",
  }),
});
