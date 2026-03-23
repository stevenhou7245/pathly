import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be between 3 and 20 characters.")
  .max(20, "Username must be between 3 and 20 characters.")
  .regex(/^[A-Za-z0-9]+$/, "Username can only contain letters and numbers.");

export const emailSchema = z
  .string()
  .trim()
  .email("Please provide a valid email address.")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "Password must be between 8 and 16 characters.")
  .max(16, "Password must be between 8 and 16 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one special character.");

export const captchaInputSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => /^[A-Z2-9]{5,6}$/.test(value),
    "CAPTCHA input must be 5-6 uppercase letters or digits.",
  );

export const captchaTokenSchema = z
  .string()
  .trim()
  .min(1, "CAPTCHA token is required.");

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const resetPasswordRequestSchema = z
  .object({
    email: emailSchema,
    captchaInput: captchaInputSchema,
    captchaToken: captchaTokenSchema,
  });

export const registerRequestSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm password is required."),
    captchaInput: captchaInputSchema,
    captchaToken: captchaTokenSchema,
  })
  .superRefine((value, ctx) => {
    if (value.confirmPassword !== value.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Confirm password must match password.",
      });
    }
  });

const nullableAvatarUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  },
  z.union([z.string().url("Avatar URL must be a valid URL."), z.null()]),
);

const nullableBioSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    return value.trim();
  },
  z.union([z.string().max(280, "Bio must be 280 characters or fewer."), z.null()]),
);

const nullableMottoSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  },
  z.union([z.string().max(200, "Motto must be 200 characters or fewer."), z.null()]),
);

const optionalAgeSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (value === "") {
      return null;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  z
    .union([
      z
        .number()
        .int("Age must be a positive integer.")
        .positive("Age must be a positive integer."),
      z.null(),
    ])
    .optional(),
);

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    age: optionalAgeSchema,
    avatar_url: nullableAvatarUrlSchema.optional(),
    bio: nullableBioSchema.optional(),
    motto: nullableMottoSchema.optional(),
  })
  .refine(
    (value) =>
      value.username !== undefined ||
      value.age !== undefined ||
      value.avatar_url !== undefined ||
      value.bio !== undefined ||
      value.motto !== undefined,
    {
      message: "At least one profile field must be provided.",
    },
  );

export const updateProfileSettingsSchema = z
  .object({
    theme: z.enum(["light", "dark"]).optional(),
    sound_effects_enabled: z.boolean().optional(),
    animations_enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.theme !== undefined ||
      value.sound_effects_enabled !== undefined ||
      value.animations_enabled !== undefined,
    {
      message: "At least one settings field must be provided.",
    },
  );
