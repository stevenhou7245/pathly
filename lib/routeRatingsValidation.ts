import { z } from "zod";

const idSchema = z
  .string()
  .trim()
  .min(1, "Route id is required.");

const optionalReviewSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    return value;
  },
  z.string().max(2000, "Review must be 2000 characters or fewer.").optional(),
);

export const submitRouteRatingSchema = z.object({
  route_id: idSchema,
  rating: z
    .coerce
    .number()
    .int("Rating must be an integer between 1 and 5.")
    .min(1, "Rating must be between 1 and 5.")
    .max(5, "Rating must be between 1 and 5."),
  review: optionalReviewSchema.optional(),
});
