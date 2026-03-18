import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getPendingReviewPopup } from "@/lib/ai/review";

export const runtime = "nodejs";

const querySchema = z.object({
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID.").optional(),
  next_course_id: z.string().uuid("next_course_id must be a valid UUID.").optional(),
});

type ReviewPopupResponse = {
  success: boolean;
  message?: string;
  popup?: {
    should_show: boolean;
    review_session_id: string | null;
    course_id: string | null;
    score_at_trigger: number | null;
    questions: Array<{
      id: string;
      question_order: number;
      question_type: "single_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      concept_tag: string;
      skill_tag: string | null;
      max_score: number;
    }>;
  };
};

export async function GET(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: ReviewPopupResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      journey_path_id: url.searchParams.get("journey_path_id")?.trim() || undefined,
      next_course_id: url.searchParams.get("next_course_id")?.trim() || undefined,
    });
    if (!parsed.success) {
      const payload: ReviewPopupResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request query.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const popup = await getPendingReviewPopup({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      nextCourseId: parsed.data.next_course_id,
    });

    const payload: ReviewPopupResponse = {
      success: true,
      popup,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/course/review/popup][GET] failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    const payload: ReviewPopupResponse = {
      success: false,
      message: "Unable to load review popup right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
