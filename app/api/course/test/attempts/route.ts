import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { listCourseTestAttempts } from "@/lib/journeyProgression";

export const runtime = "nodejs";

const querySchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
});

type CourseTestAttemptsResponse = {
  success: boolean;
  message?: string;
  attempts?: Array<{
    user_test_id: string;
    attempt_number: number;
    earned_score: number;
    total_score: number;
    pass_status: "passed" | "failed";
    graded_at: string | null;
    submitted_at: string | null;
  }>;
  best_score?: number | null;
  has_any_attempt?: boolean;
};

export async function GET(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CourseTestAttemptsResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      course_id: url.searchParams.get("course_id")?.trim() ?? "",
    });
    if (!parsed.success) {
      const payload: CourseTestAttemptsResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request query.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await listCourseTestAttempts({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
    });

    const payload: CourseTestAttemptsResponse = {
      success: true,
      attempts: result.attempts,
      best_score: result.best_score,
      has_any_attempt: result.has_any_attempt,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load test attempts right now.";
    const payload: CourseTestAttemptsResponse = {
      success: false,
      message:
        message === "Unable to load test attempt history right now."
          ? message
          : "Unable to load test attempts right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
