import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { submitTransitionReview } from "@/lib/transitionReview";

export const runtime = "nodejs";

const submitSchema = z.object({
  review_id: z.string().uuid("review_id must be a valid UUID."),
  selected_action: z.enum(["continue", "go_back"]),
  answers: z
    .array(
      z.object({
        question_index: z.number().int().min(1),
        user_answer: z.string().trim().optional(),
      }),
    )
    .optional(),
});

type TransitionReviewSubmitResponse = {
  success: boolean;
  message?: string;
  result?: {
    review_id: string;
    selected_action: "continue" | "go_back";
    score: number | null;
    total_questions: number;
    correct_count: number;
    performance: "good" | "weak";
    evaluations: Array<{
      question_index: number;
      user_answer: string;
      is_correct: boolean;
      correct_answer: string;
      explanation: string;
    }>;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: TransitionReviewSubmitResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: TransitionReviewSubmitResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      const payload: TransitionReviewSubmitResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const answers =
      parsed.data.answers?.map((answer) => ({
        question_index: answer.question_index,
        user_answer: answer.user_answer?.trim() ?? "",
      })) ?? [];

    const result = await submitTransitionReview({
      userId: sessionUser.id,
      reviewId: parsed.data.review_id,
      selectedAction: parsed.data.selected_action,
      answers,
    });

    const payload: TransitionReviewSubmitResponse = {
      success: true,
      result,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "Transition review not found." ||
      message === "Transition review questions are missing."
        ? 404
        : 500;
    console.error("[api/course/transition-review/submit][POST] failed", {
      reason: message,
    });
    const payload: TransitionReviewSubmitResponse = {
      success: false,
      message:
        status === 500
          ? "Unable to submit transition review right now."
          : message,
    };
    return NextResponse.json(payload, { status });
  }
}
