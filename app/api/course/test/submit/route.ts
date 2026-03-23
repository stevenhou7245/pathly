import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { submitCourseTest } from "@/lib/journeyProgression";

export const runtime = "nodejs";

const submitTestSchema = z
  .object({
    course_id: z.string().uuid("course_id must be a valid UUID.").optional(),
    journey_path_id: z.string().uuid("journey_path_id must be a valid UUID.").optional(),
    user_test_id: z.string().uuid("user_test_id must be a valid UUID.").optional(),
    test_attempt_id: z.string().uuid("test_attempt_id must be a valid UUID.").optional(),
    selected_resource_id: z
      .string()
      .uuid("selected_resource_id must be a valid UUID.")
      .optional(),
    answers: z.array(
      z.object({
        question_id: z.string().trim().min(1),
        selected_option_index: z.number().int().min(0).optional(),
        answer_text: z.string().trim().optional(),
        user_answer_text: z.string().trim().optional(),
      }),
    ),
  })
  .refine((value) => Boolean(value.user_test_id ?? value.test_attempt_id), {
    message: "user_test_id is required.",
  });

type SubmitCourseTestResponse = {
  success: boolean;
  message?: string;
  result?: {
    user_test_id: string;
    attempt_number: number;
    total_score: number;
    earned_score: number;
    score: number;
    pass_status: "passed" | "failed";
    passed: boolean;
    required_score: number;
    course_completed: boolean;
    attempt_count: number;
    last_test_score: number;
    best_test_score: number | null;
    completion_awarded: boolean;
    feedback_summary: string;
    graded_at: string;
    review_required?: boolean;
    review_session_id?: string | null;
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      concept_tags: string[];
      skill_tags: string[];
      user_answer: string;
      correct_answer: string;
      is_correct: boolean;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
    }>;
    journey: {
      journey_path_id: string;
      total_steps: number;
      current_step: number;
      learning_field_id: string;
      nodes: Array<{
        step_number: number;
        course_id: string;
        title: string;
        status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
        passed_score: number | null;
      }>;
    };
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SubmitCourseTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: SubmitCourseTestResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = submitTestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: SubmitCourseTestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await submitCourseTest({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      courseId: parsed.data.course_id,
      testAttemptId: parsed.data.user_test_id ?? parsed.data.test_attempt_id ?? "",
      selectedResourceId: parsed.data.selected_resource_id,
      answers: parsed.data.answers,
    });

    const payload: SubmitCourseTestResponse = {
      success: true,
      result,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit test right now.";
    const clientErrorMessages = new Set([
      "Course not found.",
      "Please complete previous courses",
      "Start learning before submitting the AI test.",
      "Selected resource not found.",
      "Test attempt not found.",
      "Invalid AI test attempt.",
      "No AI test questions found for this template.",
      "This test attempt has already been graded.",
      "This test attempt is not graded yet.",
      "Course progress not found.",
    ]);
    const status = clientErrorMessages.has(message) ? 400 : 500;
    const payload: SubmitCourseTestResponse = {
      success: false,
      message: status === 500 ? "Unable to submit test right now." : message,
    };
    return NextResponse.json(payload, { status });
  }
}
