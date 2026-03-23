import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareCourseTest } from "@/lib/journeyProgression";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const prepareTestSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID.").optional(),
  selected_resource_option_id: z
    .string()
    .uuid("selected_resource_option_id must be a valid UUID.")
    .optional(),
  selected_resource_id: z
    .string()
    .uuid("selected_resource_id must be a valid UUID.")
    .optional(),
});

type PrepareCourseTestResponse = {
  success: boolean;
  error?: string;
  message?: string;
  test?: {
    course_id: string;
    journey_path_id: string;
    user_test_id: string;
    test_attempt_id: string;
    template_id: string;
    title: string;
    difficulty_band: "beginner" | "basic" | "intermediate" | "advanced" | "expert";
    test_template: {
      course_id: string;
      course_title: string;
      difficulty_band: "beginner" | "basic" | "intermediate" | "advanced" | "expert";
      resource_context: {
        selected_resource_option_id: string | null;
        selected_resource_title: string | null;
        selected_resource_type: string | null;
        selected_resource_provider: string | null;
        selected_resource_url: string | null;
        selected_resource_summary: string | null;
      };
      metadata: {
        generated_at: string;
        attempt_number: number;
        variant_no: number;
        prompt_version: string;
        requirements_met: {
          include_concept_and_skill_tags: boolean;
          vary_from_previous_attempts: boolean;
        };
        ai_provider: string | null;
        ai_model: string | null;
        fallback_used: boolean;
        reused_existing: boolean;
      };
      questions: Array<{
        id: string;
        question_order: number;
        question_text: string;
        question_type: "multiple_choice" | "fill_blank" | "short_answer";
        options: string[];
        score: number;
      }>;
    };
    status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
    required_score: number;
    questions: Array<{
      id: string;
      question_order: number;
      question_text: string;
      prompt: string;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      options: string[];
      score: number;
    }>;
  };
};

export async function POST(request: Request) {
  console.info("[ai_test_start] request_received", {
    method: request.method,
    path: "/api/course/test",
  });
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: PrepareCourseTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
      console.info("[ai_test_start] request_body", body as Record<string, unknown>);
    } catch {
      const payload: PrepareCourseTestResponse = {
        success: false,
        error: "Invalid request payload.",
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    console.info("[ai_test_start] validation_started");
    const parsed = prepareTestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const validationError = issue?.message ?? "Invalid request payload.";
      console.error("[ai_test_start] validation_failed", {
        issues: parsed.error.issues.map((item) => ({
          path: item.path.join("."),
          message: item.message,
        })),
      });
      const payload: PrepareCourseTestResponse = {
        success: false,
        error: validationError,
        message: validationError,
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info("[ai_test_start] validation_succeeded", {
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id ?? null,
      selected_resource_option_id: parsed.data.selected_resource_option_id ?? null,
      selected_resource_id: parsed.data.selected_resource_id ?? null,
      selected_resource_payload_used_as_source_of_truth: false,
    });

    const test = await prepareCourseTest({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      courseId: parsed.data.course_id,
    });

    const payload: PrepareCourseTestResponse = {
      success: true,
      test,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare test right now.";
    const clientErrorMessages = new Set([
      "User not found.",
      "Course not found.",
      "Please complete previous courses",
      "Start learning before taking the AI test.",
      "Selected resource not found.",
      "No ready AI test template found for this course.",
      "No AI test questions found for this template.",
      "AI test template payload missing test_template.",
      "AI test template payload missing questions array.",
      "Failed to insert AI test questions",
    ]);
    const status = clientErrorMessages.has(message) ? 400 : 500;
    const payload: PrepareCourseTestResponse = {
      success: false,
      error: message,
      message,
    };
    return NextResponse.json(payload, { status });
  }
}
