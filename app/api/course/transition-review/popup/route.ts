import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getOrCreateTransitionReviewPopup } from "@/lib/transitionReview";

export const runtime = "nodejs";

const popupQuerySchema = z.object({
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID."),
  from_course_id: z.string().uuid("from_course_id must be a valid UUID."),
  to_course_id: z.string().uuid("to_course_id must be a valid UUID."),
});

type TransitionReviewPopupResponse = {
  success: boolean;
  message?: string;
  popup?: {
    should_show: boolean;
    review_id: string | null;
    from_course_id: string | null;
    to_course_id: string | null;
    instructions: string;
    questions: Array<{
      question_index: number;
      question_type: "single_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      correct_answer: string;
      explanation: string;
    }>;
  };
};

export async function GET(request: Request) {
  let currentUserId = "";
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }
    currentUserId = sessionUser.id;

    const url = new URL(request.url);
    const parsed = popupQuerySchema.safeParse({
      journey_path_id: url.searchParams.get("journey_path_id")?.trim(),
      from_course_id: url.searchParams.get("from_course_id")?.trim(),
      to_course_id: url.searchParams.get("to_course_id")?.trim(),
    });
    if (!parsed.success) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request query.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const popup = await getOrCreateTransitionReviewPopup({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      fromCourseId: parsed.data.from_course_id,
      toCourseId: parsed.data.to_course_id,
    });

    const payload: TransitionReviewPopupResponse = {
      success: true,
      popup,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clientErrorMessages = new Set([
      "Journey path not found.",
      "Selected lessons are not part of this journey.",
      "Transition review is only available for adjacent lessons.",
      "Please complete the previous lesson first.",
      "Please complete previous lessons before opening this lesson.",
      "Previous lesson not found.",
    ]);
    const status = clientErrorMessages.has(message) ? 400 : 500;
    console.error("[api/course/transition-review/popup][GET] failed", {
      user_id: currentUserId || null,
      reason: message,
    });
    const payload: TransitionReviewPopupResponse = {
      success: false,
      message:
        status === 500
          ? "Unable to load transition review right now."
          : message,
    };
    return NextResponse.json(payload, { status });
  }
}
