import { z } from "zod";

const levelSchema = z
  .string()
  .trim()
  .min(1, "Level is required.")
  .max(64, "Level must be 64 characters or fewer.");

const idSchema = z
  .string()
  .trim()
  .min(1, "ID is required.");

export const createUserLearningFieldSchema = z.object({
  field_id: idSchema.optional(),
  learning_goal: z
    .string()
    .trim()
    .min(1, "Learning goal is required.")
    .max(120, "Learning goal must be 120 characters or fewer.")
    .optional(),
  current_level: levelSchema,
  target_level: levelSchema,
  active_route_id: idSchema.optional(),
}).refine(
  (value) => value.field_id !== undefined || value.learning_goal !== undefined,
  {
    message: "Field id or learning goal is required.",
  },
);

export const updateUserLearningFieldSchema = z
  .object({
    current_level: levelSchema.optional(),
    target_level: levelSchema.optional(),
    active_route_id: z.union([idSchema, z.null()]).optional(),
    status: z
      .string()
      .trim()
      .min(1, "Status is required.")
      .max(32, "Status must be 32 characters or fewer.")
      .optional(),
  })
  .refine(
    (value) =>
      value.current_level !== undefined ||
      value.target_level !== undefined ||
      value.active_route_id !== undefined ||
      value.status !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const markNodeCompletedSchema = z.object({
  node_id: idSchema,
});
