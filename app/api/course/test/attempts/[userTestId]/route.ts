import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getCourseTestAttemptDetail } from "@/lib/journeyProgression";

export const runtime = "nodejs";

type CourseTestAttemptDetailResponse = {
  success: boolean;
  message?: string;
  attempt?: {
    user_test_id: string;
    course_id: string;
    course_title: string | null;
    course_description: string | null;
    status: string;
    attempt_number: number;
    total_score: number;
    earned_score: number;
    pass_status: "passed" | "failed";
    required_score: number;
    feedback_summary: string;
    graded_at: string | null;
    submitted_at: string | null;
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      concept_tags: string[];
      skill_tags: string[];
      options: string[];
      user_answer: string;
      correct_answer: string;
      is_correct: boolean;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
      feedback: string;
    }>;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ userTestId: string }> },
) {
  const requestStartedAt = Date.now();
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CourseTestAttemptDetailResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { userTestId } = await context.params;
    const trimmedId = userTestId?.trim() ?? "";
    console.info("[api/course/test/attempts/:id][GET] request", {
      user_id: sessionUser.id,
      attempt_id_param: trimmedId || null,
    });
    if (!trimmedId) {
      const payload: CourseTestAttemptDetailResponse = {
        success: false,
        message: "userTestId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const attempt = await getCourseTestAttemptDetail({
      userId: sessionUser.id,
      userTestId: trimmedId,
    });

    const payload: CourseTestAttemptDetailResponse = {
      success: true,
      attempt,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load test attempt detail right now.";
    console.error("[api/course/test/attempts/:id][GET] failed", {
      total_ms: Date.now() - requestStartedAt,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    const status =
      message === "Test attempt not found."
        ? 404
        : message === "Not authorized to view this test attempt."
        ? 403
        : message === "This test attempt is not graded yet."
        ? 400
        : 500;
    const payload: CourseTestAttemptDetailResponse = {
      success: false,
      message: status === 500 ? "Unable to load test attempt detail right now." : message,
    };
    return NextResponse.json(payload, { status });
  }
}
