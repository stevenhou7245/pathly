import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getCourseDetails, isCourseDetailsError } from "@/lib/journeyProgression";
import type { CourseDifficultyLevel } from "@/lib/courseDifficulty";

export const runtime = "nodejs";

type GetCourseResponse = {
  success: boolean;
  message?: string;
  course?: {
    id: string;
    journey_path_id: string;
    title: string;
    description: string | null;
    estimated_minutes: number | null;
    difficulty_level: CourseDifficultyLevel | null;
    skill_tags: string[];
    status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
    last_test_score: number | null;
    best_test_score: number | null;
    attempt_count: number;
    passed_at: string | null;
    last_activity_at: string | null;
    ready_for_test_at: string | null;
    current_test_attempt_id: string | null;
    required_test_score: number;
    can_take_test: boolean;
    review_popup: {
      should_show: boolean;
      review_session_id: string | null;
      score_at_trigger: number | null;
      question_count: number;
    };
    user_resource_preferences: Array<{
      resource_type: string;
      weighted_score: number;
      confidence: number;
    }>;
    resources: Array<{
      id: string;
      resource_option_id: string | null;
      title: string;
      resource_type: string;
      provider_name: string;
      url: string;
      description: string | null;
      average_rating: number;
      comment_count: number;
      my_rating: number | null;
      comment_previews: Array<{
        id: string;
        comment_text: string;
        created_at: string;
        username: string | null;
      }>;
    }>;
  };
};

export async function GET(
  request: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  let currentStep = "authenticate_user";

  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: GetCourseResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    currentStep = "read_route_params";
    const { courseId } = await context.params;
    currentStep = "read_query_params";
    const url = new URL(request.url);
    const journeyPathId = url.searchParams.get("journey_path_id")?.trim() ?? "";

    if (!courseId || !journeyPathId) {
      const payload: GetCourseResponse = {
        success: false,
        message: "courseId and journey_path_id are required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    currentStep = "load_course_details";
    const course = await getCourseDetails({
      userId: sessionUser.id,
      courseId,
      journeyPathId,
    });

    currentStep = "compose_response";
    const payload: GetCourseResponse = {
      success: true,
      course,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failedServiceStep = isCourseDetailsError(error) ? error.step : undefined;
    const failedStep = failedServiceStep ?? currentStep;
    const message = error instanceof Error ? error.message : String(error);

    console.error("[api/course/:courseId] Course details load failed", {
      route_step: currentStep,
      failed_step: failedStep,
      message,
      stack: error instanceof Error ? error.stack : null,
      error,
    });

    const payload: GetCourseResponse = {
      success: false,
      message: "Unable to load course details right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
