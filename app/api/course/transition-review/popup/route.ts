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

function toNumberValue(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeUuid(value: unknown) {
  return toStringValue(value).trim().toLowerCase();
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

    const { data: journeyPathRow, error: journeyPathError } = await supabaseAdmin
      .from("journey_paths")
      .select("id, user_id")
      .eq("id", normalizedJourneyPathId)
      .eq("user_id", sessionUser.id)
      .limit(1)
      .maybeSingle();

    console.info("[api/course/transition-review/popup][GET] journey_paths_query_result", {
      user_id: sessionUser.id,
      journey_path_id: normalizedJourneyPathId,
      found: Boolean(journeyPathRow),
      error_message: journeyPathError?.message ?? null,
    });

    if (journeyPathError) {
      throw journeyPathError;
    }
    if (!journeyPathRow) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: "Journey path not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
      .from("journey_path_courses")
      .select("course_id, step_number")
      .eq("journey_path_id", normalizedJourneyPathId)
      .order("step_number", { ascending: true });

    const typedPathCoursesRows = (pathCoursesRows ?? []) as GenericRecord[];

    console.info("[api/course/transition-review/popup][GET] journey_path_courses_query_result", {
      user_id: sessionUser.id,
      journey_path_id: normalizedJourneyPathId,
      row_count: typedPathCoursesRows.length,
      sample_course_ids: typedPathCoursesRows
        .slice(0, 5)
        .map((row) => normalizeUuid(row.course_id)),
      error_message: pathCoursesError?.message ?? null,
    });

    if (pathCoursesError) {
      throw pathCoursesError;
    }

    const fromPathCourse =
      typedPathCoursesRows.find(
        (row) => normalizeUuid(row.course_id) === normalizedFromCourseId,
      ) ?? null;
    const toPathCourse =
      typedPathCoursesRows.find(
        (row) => normalizeUuid(row.course_id) === normalizedToCourseId,
      ) ?? null;

    if (!fromPathCourse || !toPathCourse) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: "Selected lessons are not part of this journey.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const { data: coursesRows, error: coursesError } = await supabaseAdmin
      .from("courses")
      .select("id, title")
      .in("id", [normalizedFromCourseId, normalizedToCourseId]);
    console.info("[api/course/transition-review/popup][GET] courses_query_result", {
      user_id: sessionUser.id,
      from_course_id: normalizedFromCourseId,
      to_course_id: normalizedToCourseId,
      row_count: (coursesRows ?? []).length,
      error_message: coursesError?.message ?? null,
    });
    if (coursesError) {
      throw coursesError;
    }
    const typedCoursesRows = (coursesRows ?? []) as GenericRecord[];
    const fromCourseTitle = toStringValue(
      typedCoursesRows.find((row) => normalizeUuid(row.id) === normalizedFromCourseId)?.title,
    );
    const toCourseTitle = toStringValue(
      typedCoursesRows.find((row) => normalizeUuid(row.id) === normalizedToCourseId)?.title,
    );
    console.info("[api/course/transition-review/popup][GET] course_titles_resolved", {
      from_course_id: normalizedFromCourseId,
      to_course_id: normalizedToCourseId,
      from_course_title: fromCourseTitle || null,
      to_course_title: toCourseTitle || null,
    });

    const fromStepFromPath = Math.floor(toNumberValue(fromPathCourse.step_number));
    const toStepFromPath = Math.floor(toNumberValue(toPathCourse.step_number));
    const fromStepNumber = fromStepFromPath > 0 ? fromStepFromPath : 1;
    const toStepNumber = toStepFromPath > 0 ? toStepFromPath : fromStepNumber + 1;

    const popup = await getOrCreateTransitionReviewPopup({
      userId: sessionUser.id,
      journeyPathId: normalizedJourneyPathId,
      fromCourseId: normalizedFromCourseId,
      toCourseId: normalizedToCourseId,
    });

    const payload: TransitionReviewPopupResponse = {
      success: true,
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
    const client404Messages = new Set([
      "Journey path not found.",
      "Selected lessons are not part of this journey.",
      "Previous lesson not found.",
      "Next lesson not found.",
    ]);
    const client400Messages = new Set([
      "Transition review is only available for adjacent lessons.",
      "Please complete the previous lesson first.",
      "Please complete previous lessons before opening this lesson.",
    ]);
    const status = client404Messages.has(message)
      ? 404
      : client400Messages.has(message)
      ? 400
      : 500;

    console.error("[api/course/transition-review/popup][GET] failed", {
      user_id: currentUserId || null,
      journey_path_id: normalizedJourneyPathId || null,
      from_course_id: normalizedFromCourseId || null,
      to_course_id: normalizedToCourseId || null,
      reason: message,
      stack: error instanceof Error ? error.stack : null,
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
