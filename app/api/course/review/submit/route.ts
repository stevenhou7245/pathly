import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { submitReviewSessionAnswers } from "@/lib/ai/review";

export const runtime = "nodejs";

const submitReviewSchema = z.object({
  review_session_id: z.string().uuid("review_session_id must be a valid UUID."),
  mark_skipped: z.boolean().optional(),
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid("question_id must be a valid UUID."),
        answer_text: z.string().trim().min(1, "answer_text is required."),
      }),
    )
    .optional(),
});

type SubmitReviewResponse = {
  success: boolean;
  message?: string;
  result?: {
    review_session_id: string;
    status: "completed" | "skipped";
    total_score: number;
    earned_score: number;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SubmitReviewResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: SubmitReviewResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = submitReviewSchema.safeParse(body);
    if (!parsed.success) {
      const payload: SubmitReviewResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    if (!parsed.data.mark_skipped && (!parsed.data.answers || parsed.data.answers.length === 0)) {
      const payload: SubmitReviewResponse = {
        success: false,
        message: "answers are required unless mark_skipped is true.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await submitReviewSessionAnswers({
      userId: sessionUser.id,
      reviewSessionId: parsed.data.review_session_id,
      answers:
        parsed.data.answers?.map((item) => ({
          question_id: item.question_id,
          answer_text: item.answer_text,
        })) ?? [],
      markSkipped: Boolean(parsed.data.mark_skipped),
    });

    const payload: SubmitReviewResponse = {
      success: true,
      result,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Review session not found." ? 404 : 500;
    const payload: SubmitReviewResponse = {
      success: false,
      message: status === 404 ? message : "Unable to submit review session right now.",
    };
    return NextResponse.json(payload, { status });
  }
}
