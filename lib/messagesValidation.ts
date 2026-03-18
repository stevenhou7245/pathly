import { z } from "zod";

const idSchema = z
  .string()
  .trim()
  .min(1, "Friendship id is required.");

export const sendDirectMessageSchema = z.object({
  friendship_id: idSchema,
  body: z
    .string()
    .trim()
    .min(1, "Message body cannot be empty.")
    .max(2000, "Message body must be 2000 characters or fewer."),
});

export const markMessagesReadSchema = z.object({
  friendship_id: idSchema,
});
