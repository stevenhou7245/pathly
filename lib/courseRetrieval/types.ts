import { z } from "zod";

export const getCourseRequestSchema = z.object({
  topic: z.string().trim().min(1, "Topic is required.").max(140, "Topic is too long."),
});

export const aiGeneratedCourseInfoSchema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(220).optional(),
  description: z.string().trim().min(1).max(3000),
  difficulty_level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  estimated_minutes: z.number().int().min(10).max(600),
});

export const aiGeneratedCourseResourceSchema = z.object({
  title: z.string().trim().min(1).max(220),
  resource_type: z.enum(["video", "article", "tutorial"]),
  provider: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  summary: z.string().trim().min(1).max(1200),
  display_order: z.number().int().min(1).max(30),
});

export const aiGeneratedCoursePackageSchema = z.object({
  course: aiGeneratedCourseInfoSchema,
  resources: z.array(aiGeneratedCourseResourceSchema).min(3).max(12),
});

export type GetCourseRequest = z.infer<typeof getCourseRequestSchema>;
export type AiGeneratedCourseInfo = z.infer<typeof aiGeneratedCourseInfoSchema>;
export type AiGeneratedCourseResource = z.infer<typeof aiGeneratedCourseResourceSchema>;
export type AiGeneratedCoursePackage = z.infer<typeof aiGeneratedCoursePackageSchema>;

export type Course = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  estimated_minutes: number | null;
  difficulty_level: "Beginner" | "Intermediate" | "Advanced" | null;
  created_at: string | null;
};

export type CourseResource = {
  id: string;
  course_id: string;
  title: string;
  resource_type: string;
  provider: string;
  url: string;
  summary: string | null;
  display_order: number;
  created_at: string | null;
};

export type CourseWithResources = {
  course: Course;
  resources: CourseResource[];
};

export type GetCourseResponse = {
  success: boolean;
  message?: string;
  source?: "cache" | "database" | "ai_generated";
  data?: CourseWithResources;
};
