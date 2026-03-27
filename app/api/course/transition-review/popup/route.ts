import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOrCreateTransitionReviewPopup } from "@/lib/transitionReview";

export const runtime = "nodejs";

type GenericRecord = Record<string, unknown>;

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

const uuidQueryParamSchema = (fieldName: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.string().uuid(`${fieldName} must be a valid UUID.`),
  );

const popupQuerySchema = z.object({
  journey_path_id: uuidQueryParamSchema("journey_path_id"),
  from_course_id: uuidQueryParamSchema("from_course_id"),
  to_course_id: uuidQueryParamSchema("to_course_id"),
});

type TransitionReviewPopupResponse = {
  success: boolean;
  message?: string;
  pending_generation?: boolean;
  data?: {
    journey_path_id: string;
    from_course_id: string;
    to_course_id: string;
    from_step_number: number;
    to_step_number: number;
  };
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
  let normalizedJourneyPathId = "";
  let normalizedFromCourseId = "";
  let normalizedToCourseId = "";
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
    console.info("[api/course/transition-review/popup][GET] incoming_query_params", {
      user_id: sessionUser.id,
      journey_path_id_raw: url.searchParams.get("journey_path_id"),
      from_course_id_raw: url.searchParams.get("from_course_id"),
      to_course_id_raw: url.searchParams.get("to_course_id"),
      parse_success: parsed.success,
    });
    if (!parsed.success) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request query.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    normalizedJourneyPathId = parsed.data.journey_path_id;
    normalizedFromCourseId = parsed.data.from_course_id;
    normalizedToCourseId = parsed.data.to_course_id;

    const { data: journeyRow, error: journeyError } = await supabaseAdmin
      .from("user_learning_journey_paths")
      .select("id, user_id")
      .eq("id", normalizedJourneyPathId)
      .eq("user_id", sessionUser.id)
      .limit(1)
      .maybeSingle();

    console.info("[api/course/transition-review/popup][GET] journey_path_query_result", {
      user_id: sessionUser.id,
      journey_path_id: normalizedJourneyPathId,
      found: Boolean(journeyRow),
      error_message: journeyError?.message ?? null,
    });

    if (journeyError) {
      throw journeyError;
    }

    if (!journeyRow) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message:
          `Journey path or courses not found: missing journey_path_id=${normalizedJourneyPathId} ` +
          "for current user.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const { data: pathCourseRows, error: pathCourseError } = await supabaseAdmin
      .from("journey_path_courses")
      .select("course_id, step_number")
      .eq("journey_path_id", normalizedJourneyPathId)
      .order("step_number", { ascending: true });

    const typedPathCourseRows = (pathCourseRows ?? []) as GenericRecord[];

    console.info("[api/course/transition-review/popup][GET] journey_path_courses_query_result", {
      user_id: sessionUser.id,
      journey_path_id: normalizedJourneyPathId,
      row_count: typedPathCourseRows.length,
      sample_course_ids: typedPathCourseRows
        .slice(0, 5)
        .map((row) => toStringValue(row.course_id).trim().toLowerCase()),
      error_message: pathCourseError?.message ?? null,
    });

    if (pathCourseError) {
      throw pathCourseError;
    }

    if (typedPathCourseRows.length === 0) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        pending_generation: true,
        message:
          `Journey path or courses not found: journey_path_courses rows are not ready yet ` +
          `for journey_path_id=${normalizedJourneyPathId} (pending generation).`,
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const fromCourseRow =
      typedPathCourseRows.find(
        (row) => toStringValue(row.course_id).trim().toLowerCase() === normalizedFromCourseId,
      ) ?? null;
    const toCourseRow =
      typedPathCourseRows.find(
        (row) => toStringValue(row.course_id).trim().toLowerCase() === normalizedToCourseId,
      ) ?? null;

    if (!fromCourseRow || !toCourseRow) {
      const missingParts: string[] = [];
      if (!fromCourseRow) {
        missingParts.push(`from_course_id=${normalizedFromCourseId}`);
      }
      if (!toCourseRow) {
        missingParts.push(`to_course_id=${normalizedToCourseId}`);
      }
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message:
          `Journey path or courses not found: ${missingParts.join(", ")} ` +
          `not found in journey_path_courses for journey_path_id=${normalizedJourneyPathId}.`,
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const fromStepNumber = Math.max(
      1,
      Math.floor(Number(fromCourseRow.step_number) || 1),
    );
    const toStepNumber = Math.max(
      1,
      Math.floor(Number(toCourseRow.step_number) || 1),
    );

    const popup = await getOrCreateTransitionReviewPopup({
      userId: sessionUser.id,
      journeyPathId: normalizedJourneyPathId,
      fromCourseId: normalizedFromCourseId,
      toCourseId: normalizedToCourseId,
    });

    const payload: TransitionReviewPopupResponse = {
      success: true,
      message: "Journey path ready for review",
      data: {
        journey_path_id: normalizedJourneyPathId,
        from_course_id: normalizedFromCourseId,
        to_course_id: normalizedToCourseId,
        from_step_number: fromStepNumber,
        to_step_number: toStepNumber,
      },
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
    const status = message.includes("not found")
      ? 404
      : clientErrorMessages.has(message)
      ? 400
      : 500;
    console.error("[api/course/transition-review/popup][GET] failed", {
      user_id: currentUserId || null,
      journey_path_id: normalizedJourneyPathId || null,
      from_course_id: normalizedFromCourseId || null,
      to_course_id: normalizedToCourseId || null,
      reason: message,
    });
    const payload: TransitionReviewPopupResponse = {
      success: false,
      message:
        status === 500
          ? "Unable to load transition review right now."
          : status === 404
          ? `Journey path or courses not found: ${message}`
          : message,
    };
    return NextResponse.json(payload, { status });
  }
}
