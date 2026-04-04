import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { submitWeaknessConceptTest } from "@/lib/weaknessDrill";

export const runtime = "nodejs";

const submitSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  concept_tag: z.string().trim().min(1, "concept_tag is required."),
  test_session_id: z.string().uuid("test_session_id must be a valid UUID."),
  answers: z.array(
    z.object({
      question_id: z.string().trim().min(1),
      selected_option_index: z.number().int().min(0).optional(),
      answer_text: z.string().trim().optional(),
    }),
  ),
});

type SubmitWeaknessTestResponse = {
  success: boolean;
  message?: string;
  result?: {
    test_session_id: string;
    total_score: number;
    earned_score: number;
    percentage: number;
    pass_status: "passed" | "failed";
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      user_answer: string;
      correct_answer: string;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
    }>;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SubmitWeaknessTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = submitSchema.safeParse(rawBody);
    if (!parsed.success) {
      const payload: SubmitWeaknessTestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await submitWeaknessConceptTest({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
      conceptTag: parsed.data.concept_tag,
      testSessionId: parsed.data.test_session_id,
      answers: parsed.data.answers,
    });

    const payload: SubmitWeaknessTestResponse = {
      success: true,
      result,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: SubmitWeaknessTestResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to submit concept drill test.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
