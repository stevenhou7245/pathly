import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  submitWeaknessConceptDrillTest,
  type WeaknessDrillSubmissionResult,
} from "@/lib/ai/weaknessDrill";

export const runtime = "nodejs";

const answerSchema = z.object({
  question_id: z.string().trim().min(1).optional(),
  question_order: z.number().int().positive().optional(),
  selected_option_index: z.number().int().nullable().optional(),
  answer_text: z.string().nullable().optional(),
})
.refine(
  (value) =>
    (typeof value.question_id === "string" && value.question_id.trim().length > 0) ||
    typeof value.question_order === "number",
  {
    message: "Each answer must include question_id or question_order.",
  },
);

const requestSchema = z.object({
  concept_tag: z.string().trim().min(1).optional(),
  weakness_test_session_id: z.string().uuid("weakness_test_session_id must be a UUID."),
  answers: z.array(answerSchema).default([]),
});

type WeaknessDrillSubmitResponse = {
  success: boolean;
  message?: string;
  result?: WeaknessDrillSubmissionResult;
  weakness_test_session_id?: string;
  score?: number;
  max_score?: number;
  passed?: boolean;
  resolved_concept_tag?: string | null;
  question_results?: WeaknessDrillSubmissionResult["question_results"];
  details?: Record<string, unknown>;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: WeaknessDrillSubmitResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { courseId } = await context.params;
    if (!courseId?.trim()) {
      const payload: WeaknessDrillSubmitResponse = {
        success: false,
        message: "courseId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: WeaknessDrillSubmitResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await submitWeaknessConceptDrillTest({
      userId: sessionUser.id,
      courseId: courseId.trim(),
      conceptTag: parsed.data.concept_tag,
      weaknessTestSessionId: parsed.data.weakness_test_session_id,
      answers: parsed.data.answers,
    });

    const payload: WeaknessDrillSubmitResponse = {
      success: true,
      weakness_test_session_id: result.weakness_test_session_id,
      score: result.score,
      max_score: result.max_score,
      passed: result.passed,
      resolved_concept_tag: result.resolved_concept_tag,
      question_results: result.question_results,
      result,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const errorRecord = (error ?? {}) as Record<string, unknown>;
    const status =
      typeof errorRecord.status === "number" && Number.isFinite(errorRecord.status)
        ? Math.floor(errorRecord.status)
        : 500;
    const message =
      (error instanceof Error ? error.message : undefined) ||
      (typeof errorRecord.message === "string" ? errorRecord.message : undefined) ||
      "Unable to submit weakness concept drill.";
    const payload: WeaknessDrillSubmitResponse = {
      success: false,
      message,
      details:
        process.env.NODE_ENV === "development"
          ? {
              code: typeof errorRecord.code === "string" ? errorRecord.code : null,
              hint: typeof errorRecord.hint === "string" ? errorRecord.hint : null,
            raw_error:
                typeof error === "object" && error !== null ? errorRecord : String(error),
            }
          : undefined,
    };
    return NextResponse.json(payload, { status });
  }
}
